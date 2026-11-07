import { z } from "zod";
import { claimRow } from "@/lib/concurrency";
import { dayKey, parseZoned } from "@/lib/zone";
import { dateText } from "@/lib/zod-fields";
import { employeeForUser, employeeSummary } from "@/modules/office/employees/public";
import { appendOrderItems, orderRef, type AppendedLine } from "@/modules/workshop/orders/public";
import { defineOperation, fail, failField, type Principal, type Tx } from "@/server/operations";
import { getWorkshop } from "@/server/workshop";
import { FUTURE_TOLERANCE_MS, LABOR_TAX_BP, MAX_DAILY_TARGET_MINUTES, MAX_ENTRY_MINUTES, MIN_DAILY_TARGET_MINUTES, MIN_REASON_LENGTH, TIME_REF_TYPE } from "./constants";
import { billableQuantityMilli, billableUnitCents, entryMinutes, plausibleDuration } from "./domain";

/**
 * Operationen der Zeiterfassung. **Stempeln** (Start/Ende) ist idempotent über einen Schlüssel (Doppeltippen, Wiederholung nach verlorener Antwort buchen nicht doppelt) und atomar: je Mitarbeiter
 * läuft höchstens ein Eintrag (`TimeEntry.runningKey` ist eindeutig, solange er läuft). **Korrigieren** (ändern, stornieren, nachtragen) braucht eine Begründung und schreibt den Stand davor in den
 * Korrekturverlauf – Zeiten werden nie überschrieben oder gelöscht. Die Operationen kennen weder Weiterleitung noch Übersetzung.
 */

/** Idempotenzschlüssel der Buchung (vom Stempel-Knopf; wie `Idempotency-Key` der API). */
const keyField = z.string().regex(/^[A-Za-z0-9._:~-]{1,128}$/, { error: "validation.invalid" }).optional();
const timeText = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: "validation.invalid" });
const optionalText = (max: number) => z.string().trim().max(max).optional();
const reasonField = z.string().trim().min(MIN_REASON_LENGTH, { error: "time.errors.reasonRequired" }).max(300);
const breakField = z.coerce.number().int().min(0).max(600).default(0);

type Employee = NonNullable<Awaited<ReturnType<typeof employeeForUser>>>;

/** Das Mitarbeiterprofil der handelnden Person; ohne aktives Profil kann niemand stempeln. */
async function me(principal: Principal, tx: Tx): Promise<Employee> {
  const employee = await employeeForUser(principal.user.id, tx);
  // 422 statt 403: Die Person darf stempeln, aber zu ihrem Konto gibt es (noch) keinen Mitarbeiter – eine fehlende Voraussetzung, kein fehlendes Recht
  if (!employee) fail("invalid", "time.errors.noEmployee");
  if (!employee.active) fail("invalid", "time.errors.inactive");
  return employee;
}

/** Auftrag für eine Zeit: nur mit Auftragsfunktion und -recht, offen und ohne eingeschränkten Kunden (neue Verknüpfung, Art. 18 DSGVO). */
async function checkOrder(principal: Principal, tx: Tx, orderId: string | undefined, field: string): Promise<string | null> {
  if (!orderId) return null;
  if (!principal.features.has("workshop.orders") || !principal.can("orders.view")) failField(field, "validation.invalid");
  const ref = await orderRef(orderId, tx);
  if (!ref) failField(field, "validation.invalid");
  if (!ref.open) failField(field, "time.errors.orderClosed");
  if (ref.restricted) failField(field, "time.errors.orderRestricted");
  return ref.id;
}

/** Überschneidet sich [start, end) (end null = offen) mit einem anderen Eintrag desselben Mitarbeiters? */
async function overlaps(tx: Tx, employeeId: string, start: Date, end: Date | null, exceptId?: string): Promise<boolean> {
  const row = await tx.timeEntry.findFirst({
    where: { employeeId, voidedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}), ...(end ? { startedAt: { lt: end } } : {}), OR: [{ endedAt: null }, { endedAt: { gt: start } }] },
    select: { id: true },
  });
  return row !== null;
}

const label = (day: string, who: string) => `${day} · ${who}`;

/* ───────────── Stempeln ───────────── */

const startInput = z.object({ orderId: z.string().max(64).optional(), activity: optionalText(120), key: keyField });

/**
 * Beginnt einen Eintrag („Kommen“ / auf einen Auftrag stempeln). Derselbe Schlüssel liefert denselben Eintrag (keine Dublette). Läuft schon einer, ist das ein Fehler (`duplicate`) – auch bei
 * gleichzeitigem Start, denn `runningKey` ist eindeutig.
 */
export const startTimeOperation = defineOperation({
  name: "time.start",
  permission: "time.stamp",
  input: startInput,
  audit: "time.start",
  run: async ({ input: d, principal, tx, audit }) => {
    const employee = await me(principal, tx);
    if (d.key) {
      const same = await tx.timeEntry.findUnique({ where: { startKey: d.key }, select: { id: true, employeeId: true, startedAt: true } });
      if (same) {
        if (same.employeeId !== employee.id) fail("invalid");
        return { id: same.id, replayed: true };
      }
    }
    if (await tx.timeEntry.findFirst({ where: { runningKey: employee.id }, select: { id: true } })) fail("duplicate", "time.errors.alreadyRunning");
    const orderId = await checkOrder(principal, tx, d.orderId, "orderId");
    const startedAt = new Date();
    if (await overlaps(tx, employee.id, startedAt, null)) fail("invalid", "time.errors.overlap");
    const row = await tx.timeEntry.create({
      data: { employeeId: employee.id, orderId, startedAt, activity: d.activity || null, source: "stamp", runningKey: employee.id, startKey: d.key ?? null },
      select: { id: true },
    });
    audit({ target: label(dayKey(startedAt), `${employee.firstName} ${employee.lastName}`), entityId: row.id });
    return { id: row.id, replayed: false };
  },
});

const stopInput = z.object({ breakMinutes: breakField, key: keyField });

/** Beendet den laufenden Eintrag der Person („Gehen“, Auftrag beenden). Derselbe Schlüssel liefert denselben Eintrag nochmals. */
export const stopTimeOperation = defineOperation({
  name: "time.stop",
  permission: "time.stamp",
  input: stopInput,
  audit: "time.stop",
  run: async ({ input: d, principal, tx, audit }) => {
    const employee = await me(principal, tx);
    if (d.key) {
      const same = await tx.timeEntry.findUnique({ where: { stopKey: d.key }, select: { id: true, employeeId: true } });
      if (same) {
        if (same.employeeId !== employee.id) fail("invalid");
        return { id: same.id, replayed: true };
      }
    }
    const running = await tx.timeEntry.findFirst({ where: { runningKey: employee.id }, select: { id: true, startedAt: true } });
    if (!running) fail("invalid", "time.errors.notRunning");
    const endedAt = new Date(Math.max(Date.now(), running.startedAt.getTime()));
    // Ein Eintrag, der seit über 24 Stunden läuft, wurde vergessen: Ende und Pause setzt man bewusst per Korrektur (mit Begründung), nicht mit einem Antippen
    if (endedAt.getTime() - running.startedAt.getTime() > MAX_ENTRY_MINUTES * 60_000) fail("invalid", "time.errors.tooLong");
    const done = await tx.timeEntry.updateMany({ where: { id: running.id, runningKey: employee.id, endedAt: null }, data: { endedAt, runningKey: null, stopKey: d.key ?? null, breakMinutes: d.breakMinutes } });
    if (done.count === 0) fail("invalid", "time.errors.notRunning");
    audit({ target: label(dayKey(endedAt), `${employee.firstName} ${employee.lastName}`), entityId: running.id });
    return { id: running.id, replayed: false };
  },
});

/* ───────────── Korrigieren, stornieren, nachtragen ───────────── */

const whenFields = {
  startDate: dateText(),
  startTime: timeText,
  endDate: dateText().optional(),
  endTime: timeText.optional(),
};

/** Beginn und (optional) Ende aus den Formularfeldern; beides oder nichts für das Ende. */
function readTimes(d: { startDate: string; startTime: string; endDate?: string; endTime?: string }): { start: Date; end: Date | null } {
  const start = parseZoned(d.startDate, d.startTime);
  if (!start) failField("startTime", "validation.invalid");
  if (!d.endDate && !d.endTime) return { start, end: null };
  if (!d.endDate || !d.endTime) failField(d.endDate ? "endTime" : "endDate", "validation.required");
  const end = parseZoned(d.endDate, d.endTime);
  if (!end) failField("endTime", "validation.invalid");
  return { start, end };
}

/** Prüft Beginn/Ende eines Eintrags: nicht in der Zukunft, Ende nach Beginn, höchstens ein Tag, Pause nicht länger als die Dauer. */
function validateTimes(start: Date, end: Date | null, breakMinutes: number): void {
  const limit = Date.now() + FUTURE_TOLERANCE_MS;
  if (start.getTime() > limit) failField("startTime", "time.errors.future");
  if (end) {
    if (end.getTime() > limit) failField("endTime", "time.errors.future");
    if (end <= start) failField("endTime", "time.errors.endBeforeStart");
    if (!plausibleDuration(start, end)) failField("endTime", "time.errors.tooLong");
    if (breakMinutes > entryMinutes({ startedAt: start, endedAt: end, breakMinutes: 0 }, end)) failField("breakMinutes", "time.errors.breakTooLong");
  }
}

const correctInput = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  ...whenFields,
  breakMinutes: breakField,
  orderId: z.string().max(64).optional(),
  activity: optionalText(120),
  note: optionalText(500),
  reason: reasonField,
});

/**
 * Korrigiert einen Eintrag (Beginn, Ende, Pause, Auftrag, Tätigkeit, Notiz). **Begründung ist Pflicht**; der Stand davor steht im Korrekturverlauf. Eigene Zeiten mit `time.correct`, fremde
 * zusätzlich mit `time.correctAll`. Stornierte und bereits als Positionen übernommene Einträge sind gesperrt. Ein laufender Eintrag lässt sich so auch beenden (vergessener Stempel).
 */
export const correctTimeOperation = defineOperation({
  name: "time.correct",
  permission: "time.correct",
  input: correctInput,
  audit: "time.correct",
  run: async ({ input: d, principal, tx, audit }) => {
    const entry = await tx.timeEntry.findUnique({ where: { id: d.id }, include: { employee: { select: { firstName: true, lastName: true, userId: true } } } });
    if (!entry) fail("notFound");
    const own = entry.employee.userId === principal.user.id;
    if (!own && !principal.can("time.correctAll")) fail("notFound");
    if (entry.voidedAt) fail("invalid", "time.errors.voided");
    if (entry.transferredAt) fail("invalid", "time.errors.transferred");
    const { start, end } = readTimes(d);
    validateTimes(start, end, d.breakMinutes);
    if (!end && d.breakMinutes > 0) failField("breakMinutes", "time.errors.breakTooLong");
    if (!end && entry.endedAt) failField("endTime", "validation.required");
    if (!(await claimRow(tx.timeEntry, d.id, d.version))) fail("conflict");
    if (await overlaps(tx, entry.employeeId, start, end, entry.id)) fail("invalid", "time.errors.overlap");
    const orderId = d.orderId ? (d.orderId === entry.orderId ? entry.orderId : await checkOrder(principal, tx, d.orderId, "orderId")) : null;
    const who = principal.user.name.slice(0, 80);
    await tx.timeCorrection.create({
      data: { entryId: entry.id, kind: "edit", reason: d.reason, byName: who, prevStartedAt: entry.startedAt, prevEndedAt: entry.endedAt, prevBreakMinutes: entry.breakMinutes, prevOrderId: entry.orderId, prevActivity: entry.activity, prevNote: entry.note },
    });
    await tx.timeEntry.update({
      where: { id: entry.id },
      data: { startedAt: start, endedAt: end, breakMinutes: d.breakMinutes, orderId, activity: d.activity || null, note: d.note || null, ...(end && entry.runningKey ? { runningKey: null } : {}) },
    });
    audit({ target: label(dayKey(start), `${entry.employee.firstName} ${entry.employee.lastName}`), entityId: entry.id });
    return { id: entry.id };
  },
});

const voidInput = z.object({ id: z.string().min(1), version: z.string().min(1), reason: reasonField });

/** Storniert einen Eintrag (er bleibt mit Begründung im Verlauf stehen, zählt aber nicht mehr). Gleiche Rechte und Sperren wie beim Korrigieren. */
export const voidTimeOperation = defineOperation({
  name: "time.void",
  permission: "time.correct",
  input: voidInput,
  audit: "time.void",
  run: async ({ input: d, principal, tx, audit }) => {
    const entry = await tx.timeEntry.findUnique({ where: { id: d.id }, include: { employee: { select: { firstName: true, lastName: true, userId: true } } } });
    if (!entry) fail("notFound");
    if (entry.employee.userId !== principal.user.id && !principal.can("time.correctAll")) fail("notFound");
    if (entry.voidedAt) fail("invalid", "time.errors.voided");
    if (entry.transferredAt) fail("invalid", "time.errors.transferred");
    if (!(await claimRow(tx.timeEntry, d.id, d.version))) fail("conflict");
    await tx.timeCorrection.create({
      data: { entryId: entry.id, kind: "void", reason: d.reason, byName: principal.user.name.slice(0, 80), prevStartedAt: entry.startedAt, prevEndedAt: entry.endedAt, prevBreakMinutes: entry.breakMinutes, prevOrderId: entry.orderId, prevActivity: entry.activity, prevNote: entry.note },
    });
    await tx.timeEntry.update({ where: { id: entry.id }, data: { voidedAt: new Date(), runningKey: null } });
    audit({ target: label(dayKey(entry.startedAt), `${entry.employee.firstName} ${entry.employee.lastName}`), entityId: entry.id });
    return { id: entry.id };
  },
});

const manualInput = z.object({
  /** Mitarbeiter, für den nachgetragen wird (fremde nur mit `time.correctAll`); ohne Angabe die handelnde Person */
  employeeId: z.string().max(64).optional(),
  ...whenFields,
  breakMinutes: breakField,
  orderId: z.string().max(64).optional(),
  activity: optionalText(120),
  note: optionalText(500),
  reason: reasonField,
});

/** Trägt eine vergessene Zeit nach (Begründung Pflicht, Herkunft „nachgetragen“, im Verlauf als „angelegt“). */
export const addManualTimeOperation = defineOperation({
  name: "time.addManual",
  permission: "time.correct",
  input: manualInput,
  audit: "time.manual",
  run: async ({ input: d, principal, tx, audit }) => {
    const own = await me(principal, tx);
    let target = own;
    if (d.employeeId && d.employeeId !== own.id) {
      if (!principal.can("time.correctAll")) fail("forbidden");
      const other = await employeeSummary(d.employeeId, tx);
      if (!other?.active) failField("employeeId", "validation.invalid");
      target = other;
    }
    const { start, end } = readTimes(d);
    if (!end) failField("endDate", "validation.required");
    validateTimes(start, end, d.breakMinutes);
    if (await overlaps(tx, target.id, start, end)) fail("invalid", "time.errors.overlap");
    const orderId = await checkOrder(principal, tx, d.orderId, "orderId");
    const row = await tx.timeEntry.create({
      data: { employeeId: target.id, orderId, startedAt: start, endedAt: end, breakMinutes: d.breakMinutes, activity: d.activity || null, note: d.note || null, source: "manual" },
      select: { id: true },
    });
    await tx.timeCorrection.create({ data: { entryId: row.id, kind: "create", reason: d.reason, byName: principal.user.name.slice(0, 80) } });
    audit({ target: label(dayKey(start), `${target.firstName} ${target.lastName}`), entityId: row.id });
    return { id: row.id };
  },
});

/* ───────────── Zeiten als Positionen übernehmen ───────────── */

const transferInput = z.object({
  orderId: z.string().min(1).max(64),
  /** `h`: Stunden zum Stundensatz; `aw`: Arbeitswerte (1 AW = Minuten aus dem Werkstattprofil) */
  unit: z.enum(["h", "aw"]).default("h"),
  /** Bezeichnung der Positionen (die Oberfläche übergibt den Text ihrer Sprache); die Einheit ist `h` bzw. `AW` */
  label: z.string().trim().min(1).max(80).default("Arbeitszeit"),
});

type Prepared = { hourlyRateCents: number; workUnitMinutes: number };

/**
 * Übernimmt die beendeten, noch nicht übernommenen Zeiten eines Auftrags als **Arbeitspositionen** in den Auftrag (Stundensatz bzw. Arbeitswert aus dem Werkstattprofil). Nur mit `orders.edit`
 * **und** `orders.prices`, nur an einem offenen Auftrag. **Idempotent:** Jeder Eintrag wird atomar als übernommen markiert (bedingtes Update) – ein zweiter Aufruf, auch ein gleichzeitiger,
 * findet nichts mehr und legt nie doppelte Positionen an. Die Namen der Mitarbeiter erfährt die übernehmende Person nicht (die Positionen nennen nur Tätigkeit und Tag). Läuft noch ein Eintrag
 * auf dem Auftrag, bleibt er unberührt.
 */
export const transferTimeOperation = defineOperation({
  name: "time.transfer",
  permission: "time.view",
  input: transferInput,
  audit: "time.transfer",
  prepare: async ({ principal }): Promise<Prepared> => {
    if (!principal.features.has("workshop.orders") || !principal.can("orders.edit") || !principal.can("orders.prices")) fail("forbidden");
    const workshop = await getWorkshop();
    if (workshop.hourlyRateCents == null) fail("invalid", "time.errors.noRate");
    return { hourlyRateCents: workshop.hourlyRateCents, workUnitMinutes: workshop.workUnitMinutes };
  },
  run: async ({ input: d, prepared, tx, audit }) => {
    const order = await orderRef(d.orderId, tx);
    if (!order) fail("notFound");
    if (!order.open) fail("invalid", "orders.errors.closed");
    const now = new Date();
    const entries = await tx.timeEntry.findMany({
      where: { orderId: d.orderId, voidedAt: null, transferredAt: null, endedAt: { not: null } },
      orderBy: { startedAt: "asc" },
      select: { id: true, startedAt: true, endedAt: true, breakMinutes: true, activity: true },
    });
    if (entries.length === 0) fail("invalid", "time.errors.nothingToTransfer");
    // Als übernommen markieren, bevor Positionen entstehen: das bedingte Update ist die Sperre gegen doppelte Übernahme (gleichzeitige Aufrufe, Wiederholung)
    const marked = await tx.timeEntry.updateMany({ where: { id: { in: entries.map((e) => e.id) }, orderId: d.orderId, voidedAt: null, transferredAt: null, endedAt: { not: null } }, data: { transferredAt: now } });
    if (marked.count !== entries.length) fail("conflict");
    const billable = entries.map((e) => ({ entry: e, minutes: entryMinutes(e, now) })).filter((e) => e.minutes > 0);
    const unitCents = billableUnitCents(prepared.hourlyRateCents, d.unit, prepared.workUnitMinutes);
    const lines: AppendedLine[] = billable.map(({ entry, minutes }) => ({
      kind: "labor",
      description: `${d.label}${entry.activity ? ` – ${entry.activity}` : ""} (${dayKey(entry.startedAt)})`.slice(0, 300),
      unit: d.unit === "h" ? "h" : "AW",
      quantityMilli: billableQuantityMilli(minutes, d.unit, prepared.workUnitMinutes),
      unitCents,
      taxBp: LABOR_TAX_BP,
      refType: TIME_REF_TYPE,
      refId: entry.id,
    }));
    const itemIds = lines.length > 0 ? await appendOrderItems(tx, d.orderId, lines) : [];
    for (const [i, { entry }] of billable.entries()) await tx.timeEntry.update({ where: { id: entry.id }, data: { transferredItemId: itemIds[i] } });
    audit({ target: `${order.number}: ${lines.length}`, entityId: d.orderId });
    return { orderId: d.orderId, entries: entries.length, positions: lines.length, minutes: billable.reduce((sum, e) => sum + e.minutes, 0) };
  },
});

/* ───────────── Einstellungen ───────────── */

const settingsInput = z.object({ dailyTargetMinutes: z.coerce.number().int().min(MIN_DAILY_TARGET_MINUTES).max(MAX_DAILY_TARGET_MINUTES) });

/** Sollzeit je Arbeitstag. */
export const saveTimeSettingsOperation = defineOperation({
  name: "time.saveSettings",
  permission: "settings.manage",
  input: settingsInput,
  audit: "settings.time",
  run: async ({ input: d, tx, audit }) => {
    await tx.timeSettings.upsert({ where: { id: "default" }, update: d, create: { id: "default", ...d } });
    audit({ target: `${d.dailyTargetMinutes} min`, entityId: "default" });
    return {};
  },
});
