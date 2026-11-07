import "server-only";
import { createHash } from "node:crypto";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import { de } from "@/i18n/messages/de";
import { en } from "@/i18n/messages/en";
import { createTranslator, type Translator } from "@/i18n/translate";
import { buildCalendar, type IcalEvent } from "@/lib/ical";
import { clientIp } from "@/lib/client-ip";
import { addMonths, dayKey, endOfDay, startOfDay, workshopZone } from "@/lib/zone";
import type { Permission } from "@/modules/catalog";
import { getActiveFeatureIds } from "@/modules/features";
import { absenceSpansBetween } from "@/modules/office/employees/public";
import { fleetDeadlines } from "@/modules/office/fleet/public";
import { vehicleDeadlines } from "@/modules/workshop/vehicles/public";
import { isBehindProxy } from "@/server/auth/network";
import { authPolicy } from "@/server/auth/policy";
import { grantedPermissions, rolesGrant } from "@/server/auth/permissions";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { getPublicUrl } from "@/server/public-url";
import { getWorkshop } from "@/server/workshop";
import { FEED_MIN_INTERVAL_MS, feedCache, feedInflight, feedLimiters, feedLimits, feedRuntime, type CachedFeed } from "./feed-state";
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
 *  - **Ohne `appointments.view` gibt es keinen Feed:** ein Besitzer ohne dieses Recht oder bei ausgeschalteter Terminfunktion bekommt dieselbe 401 wie bei jedem ungültigen Token. Verliert seine Rolle das Recht,
 *    **erlischt die Abo-Adresse beim nächsten Abruf** (Zeile gelöscht, Audit `appointment.feedRevoke`) – er könnte sie sonst nie widerrufen (die Seite braucht das Recht). Bei nur ausgeschalteter Funktion bleibt
 *    sie bestehen (ungültig, aber nicht gelöscht), damit das Wiedereinschalten sie nicht kostet.
 *  - **Gültige Abrufe sind begrenzt, nicht gedrosselt:** höchstens ein vollständiger Aufbau je 30 s je Token (`feed-state.ts`: Zwischenspeicher im Prozess), `ETag` aus dem Inhaltshash und `If-None-Match` → 304.
 *  - **Umfang:** 6 Monate zurück bis 12 Monate voraus, höchstens `FEED_MAX_EVENTS` Einträge – bei Überschreitung bleiben die **nächsten** (ab heute, dann die jüngsten vergangenen), ein Hinweis-Eintrag
 *    „Kalender gekürzt“ und der Kopf `X-Truncated: 1` zeigen es an.
 */
export const FEED_PAST_MONTHS = 6;
export const FEED_FUTURE_MONTHS = 12;
export const FEED_MAX_EVENTS = 5000;

/** „zuletzt benutzt“ auf die Stunde gerundet und höchstens einmal je Stunde geschrieben (kein Schreibzugriff je Abruf). */
const LAST_USED_ROUND_MS = 3_600_000;

const dictionaries: Record<Locale, typeof de> = { de, en };

/** Der Besitzer des Tokens, wie ihn die Abfragen brauchen: Rechte und aktive Funktionen (kein Sitzungsobjekt, kein Cookie). */
export type FeedOwner = {
  userId: string;
  /** Kennung des Tokens (Schlüssel des Zwischenspeichers; nie das Token selbst) */
  tokenId: string;
  /** Sprache, Rechte und Funktionen, von denen der Inhalt abhängt – ändert sich einer, gilt ein zwischengespeicherter Feed nicht mehr */
  rightsKey: string;
  locale: Locale;
  features: ReadonlySet<string>;
  can: (permission: Permission) => boolean;
};

/** Rechte und Funktionen, die den Inhalt des Feeds bestimmen (für `rightsKey`). */
const FEED_PERMISSIONS: readonly Permission[] = ["appointments.view", "customers.view", "employees.view", "vehicles.view", "fleet.view"];
const FEED_FEATURES = ["workshop.appointments", "office.employees", "workshop.vehicles", "office.fleet"] as const;

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
      hint: true,
      expiresAt: true,
      lastUsedAt: true,
      user: {
        select: {
          id: true,
          name: true,
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

  // dieselbe Rechteberechnung wie Sitzung und API (`server/auth/permissions.ts`)
  const features = await getActiveFeatureIds();
  const permissions = grantedPermissions(roles, features);
  if (!permissions.has("appointments.view")) {
    // Verliert die Rolle das Recht, erlischt die Abo-Adresse (der Besitzer könnte sie sonst nie widerrufen); ist nur die Funktion aus, bleibt sie bestehen. Nach außen dieselbe 401.
    if (!rolesGrant(roles, "appointments.view")) {
      const removed = await db.calendarFeedToken.deleteMany({ where: { id: row.id } }).catch(() => ({ count: 0 }));
      if (removed.count > 0) await audit("appointment.feedRevoke", { actor: { id: row.user.id, name: row.user.name }, target: `${row.hint} (Recht entzogen)` });
    }
    return rejectFeed(request);
  }

  const rounded = new Date(Math.floor(now / LAST_USED_ROUND_MS) * LAST_USED_ROUND_MS);
  if (!row.lastUsedAt || row.lastUsedAt.getTime() < rounded.getTime()) {
    // atomar und ohne Schreibflut: gleichzeitige Abrufe schreiben höchstens einmal je Stunde
    await db.calendarFeedToken.updateMany({ where: { id: row.id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: rounded } }] }, data: { lastUsedAt: rounded } }).catch(() => undefined);
  }

  const locale = isLocale(row.user.locale) ? row.user.locale : DEFAULT_LOCALE;
  const rightsKey = [locale, ...FEED_PERMISSIONS.filter((p) => permissions.has(p)), ...FEED_FEATURES.filter((f) => features.has(f))].join("|");
  return { ok: true, owner: { userId: row.user.id, tokenId: row.id, rightsKey, locale, features, can: (permission) => permissions.has(permission) } };
}

/**
 * Feste Änderungszeit der **abgeleiteten** Einträge (Fristen): Sie haben keine eigene Änderungszeit, und „heute“ würde die Datei täglich ändern (jeder Eintrag für jedes Kalenderprogramm „neu“). Ändert sich
 * eine Frist, ändert sich ihre UID (sie enthält den Tag) – ein fester Wert genügt, und dieselben Daten ergeben dieselbe Datei.
 */
const DERIVED_STAMP = new Date("2020-01-01T00:00:00Z");

/** `SEQUENCE` = Minuten seit 2020-01-01 der letzten Änderung: wächst mit jeder Änderung (RFC 5545 3.8.7.4), ohne dass die Anwendung Änderungen zählen müsste; gleiche Daten, gleicher Wert. */
const sequenceOf = (modified: Date): number => Math.max(0, Math.floor((modified.getTime() - DERIVED_STAMP.getTime()) / 60_000));

/** Der Kalender zum Besitzer als Text (CRLF-Zeilen). `now` ist ein Parameter, damit Tests feste Zeiten haben. */
export async function renderFeed(owner: FeedOwner, now: Date = new Date(feedRuntime.now())): Promise<string> {
  return (await buildFeed(owner, now)).body;
}

/** Der Kalender samt der Angabe, ob er auf `FEED_MAX_EVENTS` gekürzt werden musste. */
export async function buildFeed(owner: FeedOwner, now: Date = new Date(feedRuntime.now())): Promise<{ body: string; truncated: boolean }> {
  const workshop = await getWorkshop(); // setzt auch die Zeitzone der Werkstatt für Tage und Monatsgrenzen
  const base = await getPublicUrl();
  const t: Translator["t"] = createTranslator(owner.locale, dictionaries[owner.locale], workshopZone()).t;
  const today = startOfDay(now);
  const from = addMonths(today, -FEED_PAST_MONTHS);
  const to = addMonths(today, FEED_FUTURE_MONTHS);
  const fromDay = dayKey(from);
  const toDay = dayKey(to);
  const link = (path: string) => (base ? `${base}${path}` : undefined);
  /** `at` Beginn, `until` Ende (Ganztägiges: sein Tag): ab `today` gilt ein Eintrag als „nächster“ */
  const events: Array<{ at: number; until: number; event: IcalEvent }> = [];

  if (owner.features.has("workshop.appointments")) {
    for (const a of await appointmentsForFeed(owner, startOfDay(fromDay), endOfDay(toDay), FEED_MAX_EVENTS, today)) {
      const cancelled = a.status === "cancelled" || a.status === "no_show";
      const summary = [cancelled ? t("appointments.feed.cancelled") : null, a.title, a.plate, a.customerName].filter((p): p is string => !!p && p.trim() !== "").join(" · ");
      const description = [a.typeName ? `${t("appointments.slip.kind")}: ${a.typeName}` : null, a.vehicleName ? `${t("appointments.slip.vehicle")}: ${a.vehicleName}` : null].filter(Boolean).join("\n");
      events.push({
        at: a.startsAt.getTime(),
        until: a.endsAt.getTime(),
        event: { uid: `appointment-${a.id}`, modified: a.modified, sequence: sequenceOf(a.modified), summary, description: description || undefined, url: link(`/appointments?show=${encodeURIComponent(a.id)}`), status: cancelled ? "CANCELLED" : "CONFIRMED", start: a.startsAt, end: a.endsAt },
      });
    }
  }

  if (owner.features.has("office.employees")) {
    for (const absence of await absenceSpansBetween(owner, fromDay, toDay)) {
      const start = startOfDay(absence.startDay).getTime();
      events.push({ at: start, until: endOfDay(absence.endDay).getTime(), event: { uid: `absence-${absence.id}`, modified: absence.modified, sequence: sequenceOf(absence.modified), summary: t("appointments.feed.absent", { name: absence.name }), allDay: true, startDay: absence.startDay, endDay: absence.endDay, url: link("/employees/absences") } });
    }
  }

  if (owner.features.has("workshop.vehicles")) {
    for (const d of await vehicleDeadlines(owner, fromDay, toDay)) {
      const name = [d.plate, d.vehicleName].filter(Boolean).join(" ");
      const kind = d.kind === "inspection" ? t("appointments.feed.inspection", { vehicle: name }) : t("appointments.feed.extraInspection", { vehicle: name, kind: d.extraKind ? t(`appointments.feed.extraKinds.${d.extraKind === "sp" || d.extraKind === "gas" ? d.extraKind : "other"}`) : t("appointments.feed.extraKinds.other") });
      events.push({ at: startOfDay(d.day).getTime(), until: endOfDay(d.day).getTime(), event: { uid: `deadline-vehicle-${d.kind}-${d.id}-${d.day.replaceAll("-", "")}`, modified: DERIVED_STAMP, sequence: 0, summary: kind, allDay: true, startDay: d.day, endDay: d.day, url: link(`/vehicles/${encodeURIComponent(d.id)}`) } });
    }
  }

  if (owner.features.has("office.fleet")) {
    for (const d of await fleetDeadlines(owner, fromDay, toDay)) {
      const summary = t(d.kind === "hu" ? "appointments.feed.fleetInspection" : "appointments.feed.fleetService", { vehicle: d.plate });
      events.push({ at: startOfDay(d.day).getTime(), until: endOfDay(d.day).getTime(), event: { uid: `deadline-fleet-${d.kind}-${d.id}-${d.day.replaceAll("-", "")}`, modified: DERIVED_STAMP, sequence: 0, summary, allDay: true, startDay: d.day, endDay: d.day, url: link(`/fleet/${encodeURIComponent(d.id)}`) } });
    }
  }

  // nach Beginn sortiert. Über der Grenze (der Feed bleibt eine Datei von begrenzter Größe) bleiben die **nächsten** Einträge: erst alles ab heute (bis zur Grenze), mit dem Rest die jüngsten vergangenen –
  // nie die ältesten auf Kosten der kommenden. Ein Hinweis-Eintrag und der Kopf X-Truncated sagen es.
  events.sort((a, b) => a.at - b.at || (a.event.uid < b.event.uid ? -1 : 1));
  let chosen = events;
  const truncated = events.length > FEED_MAX_EVENTS;
  if (truncated) {
    const upcoming = events.filter((e) => e.until >= today.getTime());
    const past = events.filter((e) => e.until < today.getTime());
    chosen = upcoming.length >= FEED_MAX_EVENTS ? upcoming.slice(0, FEED_MAX_EVENTS) : [...past.slice(Math.max(0, past.length - (FEED_MAX_EVENTS - upcoming.length))), ...upcoming];
  }
  const list = chosen.map((e) => e.event);
  if (truncated) {
    const day = dayKey(today);
    list.unshift({ uid: "notice-truncated", modified: DERIVED_STAMP, sequence: 0, summary: t("appointments.feed.truncated", { max: String(FEED_MAX_EVENTS) }), allDay: true, startDay: day, endDay: day });
  }
  return { body: buildCalendar({ name: `${workshop.name} – ${t("appointments.feed.calendarName")}`, events: list }), truncated };
}

/** Strenger ETag aus dem Inhalt: dieselbe Datei, derselbe Wert (`If-None-Match` → 304). */
const etagOf = (body: string): string => `"${createHash("sha256").update(body).digest("base64url").slice(0, 27)}"`;

/** Passt `If-None-Match` (Liste, `*`, schwache Form `W/`) zum aktuellen ETag? */
export function matchesEtag(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((part) => {
    const value = part.trim();
    return value === "*" || value === etag || value === `W/${etag}`;
  });
}

async function buildAndStore(owner: FeedOwner, nowMs: number): Promise<CachedFeed> {
  const { body, truncated } = await buildFeed(owner, new Date(nowMs));
  const entry: CachedFeed = { builtAt: nowMs, rightsKey: owner.rightsKey, etag: etagOf(body), truncated, body };
  feedCache.set(owner.tokenId, entry);
  return entry;
}

/**
 * Die Antwort eines **gültigen** Abrufs (die Rechte hat `authenticateFeed` schon geprüft). Höchstens ein vollständiger Aufbau je `FEED_MIN_INTERVAL_MS` je Token – Abrufe dazwischen bekommen die zuletzt gebaute
 * Datei (bzw. 304); gleichzeitige Abrufe teilen sich einen Aufbau. Ändern sich Rechte, Funktionen oder Sprache des Besitzers, wird sofort neu gebaut (`rightsKey`). `ETag` und `If-None-Match` → 304 ohne Inhalt.
 */
export async function respondFeed(owner: FeedOwner, request: Request): Promise<Response> {
  const nowMs = feedRuntime.now();
  let entry = feedCache.get(owner.tokenId);
  const fresh = entry !== undefined && entry.rightsKey === owner.rightsKey && nowMs >= entry.builtAt && nowMs - entry.builtAt < FEED_MIN_INTERVAL_MS;
  if (!fresh || !entry) {
    let run = feedInflight.get(owner.tokenId);
    if (!run) {
      run = buildAndStore(owner, nowMs).finally(() => feedInflight.delete(owner.tokenId));
      feedInflight.set(owner.tokenId, run);
    }
    entry = await run;
    // ein gleichzeitig laufender Aufbau mit anderen Rechten (Rechte änderten sich mittendrin): nicht dessen Inhalt ausliefern
    if (entry.rightsKey !== owner.rightsKey) entry = await buildAndStore(owner, nowMs);
  }
  const common = { etag: entry.etag, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
  if (matchesEtag(request.headers.get("if-none-match"), entry.etag)) return new Response(null, { status: 304, headers: common });
  return new Response(entry.body, {
    headers: {
      ...common,
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="kalender.ics"',
      ...(entry.truncated ? { "x-truncated": "1" } : {}),
    },
  });
}
