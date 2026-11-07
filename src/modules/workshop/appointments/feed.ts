import "server-only";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import { de } from "@/i18n/messages/de";
import { en } from "@/i18n/messages/en";
import { createTranslator, type Translator } from "@/i18n/translate";
import { buildCalendar, type IcalEvent } from "@/lib/ical";
import { clientIp } from "@/lib/client-ip";
import { addMonths, dayKey, endOfDay, startOfDay, workshopZone } from "@/lib/zone";
import { ALL_PERMISSIONS, featureOfPermission, type Permission } from "@/modules/catalog";
import { getActiveFeatureIds } from "@/modules/features";
import { absenceSpansBetween } from "@/modules/office/employees/public";
import { fleetDeadlines } from "@/modules/office/fleet/public";
import { vehicleDeadlines } from "@/modules/workshop/vehicles/public";
import { isBehindProxy } from "@/server/auth/network";
import { authPolicy } from "@/server/auth/policy";
import { db } from "@/server/db";
import { getPublicUrl } from "@/server/public-url";
import { getWorkshop } from "@/server/workshop";
import { feedLimiters, feedLimits, feedRuntime } from "./feed-state";
import { hashFeedToken, tokenFromFile } from "./feed-token";
import { appointmentsForFeed } from "./queries";

/**
 * Das **Kalender-Abo** (F10): ein abonnierbarer Kalender (`/api/ical/<token>.ics`, RFC 5545) mit Terminen, Abwesenheiten (nur „abwesend“) und Fristen (Prüffristen der Kundenfahrzeuge, Hauptuntersuchung und
 * Service der Firmenfahrzeuge). Die Adresse enthält ein langes Zufalls-Token, **gespeichert wird nur der SHA-256-Hash** (`feed-token.ts`); sie ist ein Geheimnis – wer sie hat, sieht den Feed.
 *
 *  - **Wirksame Rechte = aktuelle Rechte des Besitzers bei jedem Abruf** (Rollen, auf aktive Funktionen eingeschränkt – wie in einer Sitzung). Ein deaktiviertes Konto, ein ausstehender Passwortwechsel,
 *    ein abgelaufenes, widerrufenes oder unbekanntes Token sind **alle dasselbe: 401** (gleiche Antwort, gleicher Aufwand). Fehlt dem Besitzer ein Fachrecht, **fehlt dieser Teil im Feed** (der Feed bleibt
 *    gültig, aber leer).
 *  - **Drosselung nur im Fehlerpfad** (`feed-state.ts`): erst der Nachschlag des Hash, dann – nur bei ungültigem Token – der Zähler. Gültige Abrufe werden nie gedrosselt.
 *  - **Was den Feed verlassen darf:** Bezeichnung, Zeit, Status, Terminart, Kennzeichen, Fahrzeug; der Anzeigename des Kunden nur mit `customers.view`; **nie** Notizen, Telefonnummern, Arbeitsplatz, Zuständige,
 *    Art oder Anmerkung einer Abwesenheit, Halter eines Fahrzeugs. Eingeschränkt verarbeitete Kunden (Art. 18) fehlen ganz. Der Feed liegt bei einem Kalenderdienst des Besitzers (Google, Apple …) – die Hilfe sagt es.
 *  - **Umfang:** 6 Monate zurück bis 12 Monate voraus, höchstens `FEED_MAX_EVENTS` Einträge.
 */
export const FEED_PAST_MONTHS = 6;
export const FEED_FUTURE_MONTHS = 12;
export const FEED_MAX_EVENTS = 5000;

/** „zuletzt benutzt“ auf die Stunde gerundet und höchstens einmal je Stunde geschrieben (kein Schreibzugriff je Abruf). */
const LAST_USED_ROUND_MS = 3_600_000;

const dictionaries: Record<Locale, typeof de> = { de, en };

/** Der Besitzer des Tokens, wie ihn die Abfragen brauchen: Rechte und aktive Funktionen (kein Sitzungsobjekt, kein Cookie). */
export type FeedOwner = { userId: string; locale: Locale; features: ReadonlySet<string>; can: (permission: Permission) => boolean };

export type FeedAuth = { ok: true; owner: FeedOwner } | { ok: false; response: Response };

const NO_STORE = { "cache-control": "no-store", "x-content-type-options": "nosniff", "content-type": "text/plain; charset=utf-8" } as const;

/**
 * Ungültiger Aufruf: 401 – oder 429, wenn die Fehlversuche überhandnehmen (nur dieser Pfad). Erst das billige globale Budget (ein Zähler), die Proxy-Einstellung (eine Datenbankabfrage) erst,
 * wenn es nicht schon reicht. Alle Ablehnungsgründe sehen von außen gleich aus; kein `WWW-Authenticate` (Kalenderprogramme würden sonst nach einem Passwort fragen).
 */
async function rejectFeed(request: Request): Promise<FeedAuth> {
  const global = feedLimiters.failuresGlobal.hit("all", feedLimits.failuresGlobal);
  let wait = global.allowed ? 0 : global.resetSeconds;
  if (global.allowed) {
    const ip = clientIp(request.headers.get("x-forwarded-for"), await isBehindProxy());
    const perIp = ip ? feedLimiters.failuresPerIp.hit(ip, feedLimits.failuresPerIp) : null;
    if (perIp && !perIp.allowed) wait = perIp.resetSeconds;
  }
  if (wait > 0) return { ok: false, response: new Response("Too Many Requests\n", { status: 429, headers: { ...NO_STORE, "retry-after": String(wait) } }) };
  return { ok: false, response: new Response("Unauthorized\n", { status: 401, headers: NO_STORE }) };
}

/** Prüft das Token (letzter Teil der Adresse, `<token>.ics`) und liefert den Besitzer – oder die Ablehnung. */
export async function authenticateFeed(file: string, request: Request): Promise<FeedAuth> {
  const token = tokenFromFile(file);
  if (!token) return rejectFeed(request);

  const row = await db.calendarFeedToken.findUnique({
    where: { tokenHash: hashFeedToken(token) },
    select: {
      id: true,
      expiresAt: true,
      lastUsedAt: true,
      user: {
        select: {
          id: true,
          active: true,
          mustChangePassword: true,
          locale: true,
          roles: { select: { role: { select: { isAdmin: true, permissions: { select: { permission: true } } } } } },
          twoFactor: { select: { enabledAt: true } },
        },
      },
    },
  });
  const now = feedRuntime.now();
  if (!row || (row.expiresAt && row.expiresAt.getTime() <= now) || !row.user.active || row.user.mustChangePassword) return rejectFeed(request);
  const roles = row.user.roles.map((r) => r.role);
  // Verlangt die Richtlinie den zweiten Faktor für Administratoren und hat ein Administrator-Konto ihn nicht eingerichtet, gilt das auch hier (wie bei Sitzung und API): bis zur Einrichtung abgelehnt
  if (roles.some((r) => r.isAdmin) && !row.user.twoFactor?.enabledAt && (await authPolicy()).requireTwoFactorForAdmins) return rejectFeed(request);

  const rounded = new Date(Math.floor(now / LAST_USED_ROUND_MS) * LAST_USED_ROUND_MS);
  if (!row.lastUsedAt || row.lastUsedAt.getTime() < rounded.getTime()) {
    // atomar und ohne Schreibflut: gleichzeitige Abrufe schreiben höchstens einmal je Stunde
    await db.calendarFeedToken.updateMany({ where: { id: row.id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: rounded } }] }, data: { lastUsedAt: rounded } }).catch(() => undefined);
  }

  const features = await getActiveFeatureIds();
  const granted: readonly string[] = roles.some((r) => r.isAdmin) ? ALL_PERMISSIONS : roles.flatMap((r) => r.permissions.map((p) => p.permission));
  const permissions = new Set(granted.filter((p) => features.has(featureOfPermission(p) ?? "")));
  return { ok: true, owner: { userId: row.user.id, locale: isLocale(row.user.locale) ? row.user.locale : DEFAULT_LOCALE, features, can: (permission) => permissions.has(permission) } };
}

/** Der Kalender zum Besitzer als Text (CRLF-Zeilen). `now` ist ein Parameter, damit Tests feste Zeiten haben. */
export async function renderFeed(owner: FeedOwner, now: Date = new Date(feedRuntime.now())): Promise<string> {
  const workshop = await getWorkshop(); // setzt auch die Zeitzone der Werkstatt für Tage und Monatsgrenzen
  const base = await getPublicUrl();
  const t: Translator["t"] = createTranslator(owner.locale, dictionaries[owner.locale], workshopZone()).t;
  const today = startOfDay(now);
  const from = addMonths(today, -FEED_PAST_MONTHS);
  const to = addMonths(today, FEED_FUTURE_MONTHS);
  const fromDay = dayKey(from);
  const toDay = dayKey(to);
  const stampToday = today;
  const link = (path: string) => (base ? `${base}${path}` : undefined);
  const events: Array<{ at: number; event: IcalEvent }> = [];

  if (owner.features.has("workshop.appointments")) {
    for (const a of await appointmentsForFeed(owner, startOfDay(fromDay), endOfDay(toDay), FEED_MAX_EVENTS)) {
      const cancelled = a.status === "cancelled" || a.status === "no_show";
      const summary = [cancelled ? t("appointments.feed.cancelled") : null, a.title, a.plate, a.customerName].filter((p): p is string => !!p && p.trim() !== "").join(" · ");
      const description = [a.typeName ? `${t("appointments.slip.kind")}: ${a.typeName}` : null, a.vehicleName ? `${t("appointments.slip.vehicle")}: ${a.vehicleName}` : null].filter(Boolean).join("\n");
      events.push({
        at: a.startsAt.getTime(),
        event: { uid: `appointment-${a.id}`, modified: a.modified, summary, description: description || undefined, url: link(`/appointments?show=${encodeURIComponent(a.id)}`), status: cancelled ? "CANCELLED" : "CONFIRMED", start: a.startsAt, end: a.endsAt },
      });
    }
  }

  if (owner.features.has("office.employees")) {
    for (const absence of await absenceSpansBetween(owner, fromDay, toDay)) {
      events.push({ at: startOfDay(absence.startDay).getTime(), event: { uid: `absence-${absence.id}`, modified: absence.modified, summary: t("appointments.feed.absent", { name: absence.name }), allDay: true, startDay: absence.startDay, endDay: absence.endDay, url: link("/employees/absences") } });
    }
  }

  if (owner.features.has("workshop.vehicles")) {
    for (const d of await vehicleDeadlines(owner, fromDay, toDay)) {
      const name = [d.plate, d.vehicleName].filter(Boolean).join(" ");
      const kind = d.kind === "inspection" ? t("appointments.feed.inspection", { vehicle: name }) : t("appointments.feed.extraInspection", { vehicle: name, kind: d.extraKind ? t(`appointments.feed.extraKinds.${d.extraKind === "sp" || d.extraKind === "gas" ? d.extraKind : "other"}`) : t("appointments.feed.extraKinds.other") });
      events.push({ at: startOfDay(d.day).getTime(), event: { uid: `deadline-vehicle-${d.kind}-${d.id}-${d.day.replaceAll("-", "")}`, modified: stampToday, summary: kind, allDay: true, startDay: d.day, endDay: d.day, url: link(`/vehicles/${encodeURIComponent(d.id)}`) } });
    }
  }

  if (owner.features.has("office.fleet")) {
    for (const d of await fleetDeadlines(owner, fromDay, toDay)) {
      const summary = t(d.kind === "hu" ? "appointments.feed.fleetInspection" : "appointments.feed.fleetService", { vehicle: d.plate });
      events.push({ at: startOfDay(d.day).getTime(), event: { uid: `deadline-fleet-${d.kind}-${d.id}-${d.day.replaceAll("-", "")}`, modified: stampToday, summary, allDay: true, startDay: d.day, endDay: d.day, url: link(`/fleet/${encodeURIComponent(d.id)}`) } });
    }
  }

  // nach Beginn sortiert; über der Grenze fallen die spätesten weg (der Feed bleibt eine Datei von begrenzter Größe)
  events.sort((a, b) => a.at - b.at || (a.event.uid < b.event.uid ? -1 : 1));
  return buildCalendar({ name: `${workshop.name} – ${t("appointments.feed.calendarName")}`, events: events.slice(0, FEED_MAX_EVENTS).map((e) => e.event) });
}
