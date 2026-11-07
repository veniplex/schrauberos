import { z } from "zod";
import { dateText } from "@/lib/zod-fields";
import { claimRow } from "@/lib/concurrency";
import { isHexColor } from "@/lib/color";
import { APPOINTMENT_KINDS, APPOINTMENT_STATUSES, QUICK_STATUSES } from "@/modules/workshop/appointments/constants";
import { unrestrictedDocument } from "@/modules/workshop/customers/public";
import { confirmOwnPassword } from "@/server/auth/confirm-password";
import { defineOperation, fail, failField, type RunContext } from "@/server/operations";
import { FEED_EXPIRY_CHOICES, feedExpiry, feedTokenHint, generateFeedToken, hashFeedToken } from "./feed-token";
import { appointmentWindow, findBayClash, quickStatusOptions } from "./domain";

const appointmentInput = z.object({
  id: z.string().optional(),
  version: z.string().optional(),
  title: z.string().trim().min(1).max(120),
  typeId: z.string().optional(),
  vehicleId: z.string().optional(),
  /** Kunde direkt (auch ohne Fahrzeug). Mit einem Fahrzeug, das einen Halter hat, gilt der Halter; ein anderer Kunde wäre ein Widerspruch. */
  customerId: z.string().optional(),
  bayId: z.string().optional(),
  assigneeId: z.string().optional(),
  tireSetId: z.string().optional(),
  date: dateText(),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  duration: z.coerce.number().int().min(5).max(720),
  status: z.enum(APPOINTMENT_STATUSES).default("scheduled"),
  notes: z.string().max(2000).optional(),
  returnTo: z.string().optional(),
});

export type AppointmentInput = z.output<typeof appointmentInput>;

/** Gemeinsamer Ablauf von Anlegen und Ändern (je ein eigenes Recht, daher zwei Operationen). */
async function saveAppointmentRun({ input: d, principal, tx, audit }: RunContext<AppointmentInput, undefined>): Promise<{ id: string }> {
  const window = appointmentWindow(d.date, d.time, d.duration);
  if (!window) failField("date", "validation.invalid");
  const { startsAt, endsAt } = window;

  const vehicle = d.vehicleId ? await tx.vehicle.findUnique({ where: { id: d.vehicleId }, select: { id: true, customerId: true, archivedAt: true, customer: { select: { processingRestrictedAt: true } } } }) : null;
  if (d.vehicleId && !vehicle) failField("vehicleId", "validation.invalid");

  // Alle Verweise müssen existieren (statt eines Datenbankfehlers); Terminart, Arbeitsplatz, Mitarbeiter, Fahrzeug und Kunde müssen aktiv (nicht archiviert) sein –
  // es sei denn, der bestehende Termin hat sie schon (dann bleibt der Wert unverändert möglich).
  const current = d.id ? await tx.appointment.findUnique({ where: { id: d.id }, select: { typeId: true, bayId: true, assigneeId: true, vehicleId: true, customerId: true } }) : null;
  if (d.id && !current) fail("notFound");
  if (vehicle?.archivedAt && vehicle.id !== current?.vehicleId) failField("vehicleId", "validation.invalid");
  // Neue Verknüpfung mit dem Fahrzeug eines Kunden mit eingeschränkter Verarbeitung (Art. 18 DSGVO): nein – ein bestehender Termin behält sein Fahrzeug
  if (vehicle?.customer?.processingRestrictedAt && vehicle.id !== current?.vehicleId) failField("vehicleId", "appointments.errors.customerRestricted");

  // Kunde: Hat das Fahrzeug einen Halter, ist der Termin dessen Kunde (ein anderer wäre ein Widerspruch). Sonst gilt der gewählte Kunde – auch ohne Fahrzeug.
  let customerId: string | null = vehicle?.customerId ?? null;
  if (vehicle?.customerId) {
    if (d.customerId && d.customerId !== vehicle.customerId) failField("customerId", "appointments.errors.customerMismatch");
  } else if (d.customerId) {
    const customer = await tx.customer.findFirst({ where: { id: d.customerId, OR: [{ archivedAt: null, processingRestrictedAt: null }, { id: current?.customerId ?? "" }] }, select: { id: true } });
    if (!customer) failField("customerId", "validation.invalid");
    customerId = customer.id;
  }
  if (d.typeId && d.typeId !== current?.typeId && !(await tx.appointmentType.findFirst({ where: { id: d.typeId, active: true }, select: { id: true } }))) failField("typeId", "validation.invalid");
  if (d.bayId && d.bayId !== current?.bayId && !(await tx.bay.findFirst({ where: { id: d.bayId, active: true }, select: { id: true } }))) failField("bayId", "validation.invalid");
  if (d.assigneeId && d.assigneeId !== current?.assigneeId && !(await tx.user.findFirst({ where: { id: d.assigneeId, active: true }, select: { id: true } }))) failField("assigneeId", "validation.invalid");
  if (d.tireSetId) {
    // Der Reifensatz muss existieren und zum gewählten Fahrzeug gehören
    const set = await tx.tireSet.findUnique({ where: { id: d.tireSetId }, select: { vehicleId: true } });
    if (!set) failField("tireSetId", "validation.invalid");
    if (!vehicle || set.vehicleId !== vehicle.id) failField("vehicleId", "appointments.errors.tireSetMismatch");
  }

  // Doppelbelegung des Arbeitsplatzes: Prüfen und Speichern laufen in derselben Transaktion (SQLite hat einen Schreiber), zwei
  // gleichzeitige Buchungen desselben Arbeitsplatzes schieben sich also nicht beide an der Prüfung vorbei. Die Entscheidung trifft die
  // reine Funktion `findBayClash`; die Abfrage grenzt nur grob auf Arbeitsplatz und Zeitfenster ein.
  if (d.bayId) {
    const candidates = await tx.appointment.findMany({
      where: { bayId: d.bayId, id: d.id ? { not: d.id } : undefined, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
      include: { vehicle: { select: { plate: true } } },
    });
    const clash = findBayClash({ id: d.id, bayId: d.bayId, status: d.status, startsAt, endsAt }, candidates);
    if (clash) {
      // Kennzeichen/Titel des fremden Termins nur für Personen, die Termine sehen dürfen, und nie von einem Kunden mit eingeschränkter Verarbeitung (Art. 18; Kunde oder Fahrzeughalter) – sonst nur der Zeitraum
      const mayName = principal.can("appointments.view") && (await tx.appointment.count({ where: { id: clash.id, ...unrestrictedDocument } })) > 0;
      const span = { from: clash.startsAt.toISOString(), to: clash.endsAt.toISOString() };
      if (mayName) failField("bayId", "appointments.errors.bayBusy", { ...span, title: clash.vehicle?.plate ?? clash.title });
      failField("bayId", "appointments.errors.bayBusyUnnamed", span);
    }
  }

  const data = {
    title: d.title,
    startsAt,
    endsAt,
    status: d.status,
    notes: d.notes ?? null,
    typeId: d.typeId ?? null,
    bayId: d.bayId ?? null,
    assigneeId: d.assigneeId ?? null,
    vehicleId: vehicle?.id ?? null,
    customerId,
    tireSetId: d.tireSetId ?? null,
  };
  let id: string;
  if (d.id) {
    if (!(await claimRow(tx.appointment, d.id, d.version))) fail("conflict");
    await tx.appointment.update({ where: { id: d.id }, data });
    id = d.id;
  } else {
    id = (await tx.appointment.create({ data: { ...data, createdById: principal.user.id } })).id;
  }
  audit({ target: d.title, entityId: id });
  return { id };
}

export const createAppointmentOperation = defineOperation({
  name: "appointments.create",
  permission: "appointments.create",
  input: appointmentInput.refine((d) => !d.id, { message: "validation.invalid", path: ["id"] }),
  audit: "appointment.create",
  run: saveAppointmentRun,
});

export const updateAppointmentOperation = defineOperation({
  name: "appointments.update",
  permission: "appointments.edit",
  input: appointmentInput.refine((d) => !!d.id, { message: "validation.invalid", path: ["id"] }),
  audit: "appointment.update",
  run: saveAppointmentRun,
});

/**
 * Schnellstatus: „Starten“ (In Arbeit) und „Fertig“ direkt auf Karte, Liste und Übersicht. Wie das Bearbeiten ein Recht `appointments.edit`, aber nur der Status
 * ändert sich (Zeit, Arbeitsplatz und alles andere bleiben, deshalb keine Prüfung auf Doppelbelegung). `version` ist Pflicht: Hat jemand den Termin inzwischen
 * geändert oder denselben Schritt schon getan, meldet die Aktion einen Konflikt statt still zu überschreiben. Erlaubt sind nur die Schritte aus `quickStatusOptions`.
 */
export const setAppointmentStatusOperation = defineOperation({
  name: "appointments.setStatus",
  permission: "appointments.edit",
  input: z.object({ id: z.string().min(1), version: z.string().min(1), status: z.enum(QUICK_STATUSES) }),
  audit: "appointment.status",
  run: async ({ input, tx, audit }) => {
    const appointment = await tx.appointment.findUnique({ where: { id: input.id }, select: { title: true, status: true } });
    if (!appointment) fail("notFound");
    if (appointment.status === input.status) fail("conflict");
    if (!quickStatusOptions(appointment.status).includes(input.status)) fail("invalid", "appointments.errors.statusStep");
    if (!(await claimRow(tx.appointment, input.id, input.version))) fail("conflict");
    await tx.appointment.update({ where: { id: input.id }, data: { status: input.status } });
    audit({ target: `${appointment.title}: ${input.status}`, entityId: input.id });
    return { id: input.id, status: input.status };
  },
});

export const deleteAppointmentOperation = defineOperation({
  name: "appointments.delete",
  permission: "appointments.delete",
  input: z.object({ id: z.string().min(1), returnTo: z.string().optional() }),
  audit: "appointment.delete",
  run: async ({ input, tx, audit }) => {
    const appointment = await tx.appointment.findUnique({ where: { id: input.id }, select: { title: true } });
    if (!appointment) fail("notFound");
    await tx.appointment.delete({ where: { id: input.id } });
    audit({ target: appointment.title, entityId: input.id });
    return { id: input.id };
  },
});

/* ───────────── Einstellungen (Kalender) ───────────── */

const settingsInput = z
  .object({
    dayStartHour: z.coerce.number().int().min(0).max(23),
    dayEndHour: z.coerce.number().int().min(1).max(24),
    slotMinutes: z.coerce.number().int().refine((v) => [10, 15, 20, 30, 60].includes(v)),
  })
  .superRefine((d, ctx) => {
    if (d.dayEndHour <= d.dayStartHour) ctx.addIssue({ code: "custom", message: "appointments.settings.errors.hoursOrder", path: ["dayEndHour"] });
  });

export const saveSettingsOperation = defineOperation({
  name: "appointments.saveSettings",
  permission: "appointments.configure",
  input: settingsInput,
  audit: "settings.appointments",
  run: async ({ input: d, tx, audit }) => {
    await tx.appointmentSettings.upsert({ where: { id: "default" }, update: d, create: { id: "default", ...d } });
    audit({ target: `${d.dayStartHour}–${d.dayEndHour}, ${d.slotMinutes} min`, entityId: "default" });
    return {};
  },
});

/* ───────────── Arbeitsplätze ───────────── */

/** Arbeitsplatz anlegen/ändern; `active` (nicht archiviert) bleibt beim Ändern unverändert, wenn es fehlt – Archivieren und Wiederaktivieren sind eigene Operationen. */
const bayInput = z.object({ id: z.string().optional(), name: z.string().trim().min(1).max(60), sortOrder: z.coerce.number().int().min(0).max(999).default(0), active: z.boolean().optional() });

export const saveBayOperation = defineOperation({
  name: "appointments.saveBay",
  permission: "appointments.configure",
  input: bayInput,
  audit: "settings.appointments",
  run: async ({ input: { id, ...data }, tx, audit }) => {
    // Neue Arbeitsplätze sind immer aktiv; archiviert wird über die eigene Operation
    const saved = id ? await tx.bay.update({ where: { id }, data }) : await tx.bay.create({ data: { ...data, active: true } });
    audit({ target: `Bay: ${saved.name}`, entityId: saved.id });
    return { id: saved.id };
  },
});

export const deleteBayOperation = defineOperation({
  name: "appointments.deleteBay",
  permission: "appointments.configure",
  input: z.object({ id: z.string().min(1) }),
  audit: "settings.appointments",
  run: async ({ input, tx, audit }) => {
    const bay = await tx.bay.findUnique({ where: { id: input.id }, select: { name: true, _count: { select: { appointments: true } } } });
    if (!bay) fail("notFound");
    // Löschschutz: Hängen Termine daran, wird archiviert statt gelöscht (der Platz bleibt an den Terminen, ist aber nicht mehr wählbar)
    if (bay._count.appointments > 0) fail("inUse", "appointments.errors.bayInUse", { count: bay._count.appointments });
    await tx.bay.delete({ where: { id: input.id } });
    audit({ target: `Bay deleted: ${bay.name}`, entityId: input.id });
    return { id: input.id };
  },
});

/* ───────────── Terminarten ───────────── */

/** Arbeitsplatz archivieren (nicht mehr wählbar, Termine behalten ihn) bzw. wieder aktivieren. */
export const archiveBayOperation = defineOperation({
  name: "appointments.archiveBay",
  permission: "appointments.configure",
  input: z.object({ id: z.string().min(1), archived: z.boolean() }),
  audit: "settings.appointments",
  run: async ({ input, tx, audit }) => {
    const bay = await tx.bay.findUnique({ where: { id: input.id }, select: { name: true } });
    if (!bay) fail("notFound");
    await tx.bay.update({ where: { id: input.id }, data: { active: !input.archived } });
    audit({ target: `Bay ${input.archived ? "archived" : "reactivated"}: ${bay.name}`, entityId: input.id });
    return { id: input.id };
  },
});

const typeInput = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(60),
  color: z.string().refine(isHexColor),
  defaultMinutes: z.coerce.number().int().min(5).max(720),
  kind: z.enum(APPOINTMENT_KINDS).default("general"),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  active: z.boolean().optional(),
});

export const saveTypeOperation = defineOperation({
  name: "appointments.saveType",
  permission: "appointments.configure",
  input: typeInput,
  audit: "settings.appointments",
  run: async ({ input: { id, ...data }, tx, audit }) => {
    const saved = id ? await tx.appointmentType.update({ where: { id }, data }) : await tx.appointmentType.create({ data: { ...data, active: true } });
    audit({ target: `Type: ${saved.name}`, entityId: saved.id });
    return { id: saved.id };
  },
});

export const deleteTypeOperation = defineOperation({
  name: "appointments.deleteType",
  permission: "appointments.configure",
  input: z.object({ id: z.string().min(1) }),
  audit: "settings.appointments",
  run: async ({ input, tx, audit }) => {
    const type = await tx.appointmentType.findUnique({ where: { id: input.id }, select: { name: true, _count: { select: { appointments: true } } } });
    if (!type) fail("notFound");
    if (type._count.appointments > 0) fail("inUse", "appointments.errors.typeInUse", { count: type._count.appointments });
    await tx.appointmentType.delete({ where: { id: input.id } });
    audit({ target: `Type deleted: ${type.name}`, entityId: input.id });
    return { id: input.id };
  },
});


/** Terminart archivieren (nicht mehr wählbar, Termine behalten sie) bzw. wieder aktivieren. */
export const archiveTypeOperation = defineOperation({
  name: "appointments.archiveType",
  permission: "appointments.configure",
  input: z.object({ id: z.string().min(1), archived: z.boolean() }),
  audit: "settings.appointments",
  run: async ({ input, tx, audit }) => {
    const type = await tx.appointmentType.findUnique({ where: { id: input.id }, select: { name: true } });
    if (!type) fail("notFound");
    await tx.appointmentType.update({ where: { id: input.id }, data: { active: !input.archived } });
    audit({ target: `Type ${input.archived ? "archived" : "reactivated"}: ${type.name}`, entityId: input.id });
    return { id: input.id };
  },
});

/* ───────────── Kalender-Abo (F10) ───────────── */

const feedPasswordInput = z.object({ password: z.string().max(1024) });

/**
 * Abo-Adresse erzeugen oder **erneuern** (ein Token je Benutzer: das neue ersetzt das alte, das damit ungültig ist). Verlangt die **erneute Passwortabfrage** der handelnden Person – ein Kalender-Abo
 * ist ein weiterer Zugang zu Daten außerhalb der Anwendung, eine gestohlene Sitzung soll ihn nicht anlegen können (mit dem Limit des Passwortwechsels, `confirmOwnPassword`). Der **Klartext** steht
 * ausschließlich in der Antwort (nie in Log, Audit oder Datenbank; gespeichert wird der SHA-256-Hash). Eigene Rechte: nur wer Termine sehen darf, bekommt ein Abo – und nur für das eigene Konto.
 * Kein API-Ressourcen-Pendant (Konto-/Sicherheitsvorgang, `api-exceptions.ts`).
 */
export const createFeedOperation = defineOperation({
  name: "appointments.createFeed",
  permission: "appointments.view",
  input: feedPasswordInput.extend({ expires: z.enum(FEED_EXPIRY_CHOICES).default("never") }),
  audit: "appointment.feedCreate",
  prepare: async ({ input, principal }) => {
    await confirmOwnPassword(principal.user.id, input.password);
    return undefined;
  },
  run: async ({ input, principal, tx, audit }) => {
    const token = generateFeedToken();
    const expiresAt = feedExpiry(input.expires, new Date());
    const replaced = await tx.calendarFeedToken.deleteMany({ where: { userId: principal.user.id } });
    await tx.calendarFeedToken.create({ data: { userId: principal.user.id, tokenHash: hashFeedToken(token), hint: feedTokenHint(token), expiresAt } });
    audit({ target: `${principal.user.username}: ${feedTokenHint(token)}${replaced.count > 0 ? " (ersetzt)" : ""}` });
    return { token, expiresAt };
  },
});

/** Abo widerrufen (die Zeile wird gelöscht; die Adresse liefert danach 401). Ebenfalls mit Passwortabfrage. */
export const revokeFeedOperation = defineOperation({
  name: "appointments.revokeFeed",
  permission: "appointments.view",
  input: feedPasswordInput,
  audit: "appointment.feedRevoke",
  prepare: async ({ input, principal }) => {
    await confirmOwnPassword(principal.user.id, input.password);
    return undefined;
  },
  run: async ({ principal, tx, audit }) => {
    const row = await tx.calendarFeedToken.findUnique({ where: { userId: principal.user.id }, select: { hint: true } });
    if (!row) fail("notFound", "appointments.feedPage.status.none");
    await tx.calendarFeedToken.delete({ where: { userId: principal.user.id } });
    audit({ target: `${principal.user.username}: ${row.hint}` });
    return { revoked: true };
  },
});
