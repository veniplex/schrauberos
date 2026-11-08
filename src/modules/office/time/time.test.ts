import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { versionOf } from "@/lib/concurrency";
import { addDaysToKey, dayKey, parseZoned, timeKey } from "@/lib/zone";
import type { AppSession } from "@/server/auth/session";
import type { Outcome } from "@/server/operations/operation";
import { createTestEnv, type TestEnv } from "@/test/harness";
import { withWorkshopZone } from "@/test/zone";

/**
 * Zeiterfassung gegen eine echte temporäre SQLite: Stempeln (genau ein laufender Eintrag, auch bei gleichzeitigem Start; Idempotenz-Schlüssel), Korrigieren/Stornieren/Nachtragen mit Pflicht-Begründung
 * und Korrekturverlauf, Überschneidungen, „nur eigene Zeiten“ (Lesen und Ändern), Übernahme als Auftragspositionen (einmalig, auch gleichzeitig), Rechte und Sperren.
 */
let env: TestEnv;
let ops: typeof import("./operations");
let queries: typeof import("./queries");
let orderOps: typeof import("@/modules/workshop/orders/operations");
let staff: AppSession;
let staff2: AppSession;
let manager: AppSession;
let noProfile: AppSession;
let advisor: AppSession;
let admin: AppSession;
let staffEmployee: string;
let staff2Employee: string;
let vehicleId: string;

const STAFF = ["time.view", "time.stamp", "time.correct", "orders.view"];
const MANAGER = ["time.view", "time.correct", "time.viewAll", "time.correctAll", "orders.view"];
const ADVISOR = ["time.view", "orders.view", "orders.create", "orders.edit", "orders.prices"];

const out = <T>(outcome: Outcome<T>): T => {
  assert.ok(outcome.ok, JSON.stringify(!outcome.ok && outcome.failure));
  return outcome.data;
};
const failure = <T>(outcome: Outcome<T>) => {
  assert.ok(!outcome.ok, "Fehler erwartet");
  return outcome.failure;
};

async function sessionFor(permissions: readonly string[], options: { admin?: boolean; employee?: { firstName: string; lastName: string; active?: boolean; workWeekdays?: string } } = {}): Promise<{ session: AppSession; employeeId: string | null }> {
  const role = await env.role({ isAdmin: options.admin, permissions });
  const user = await env.user({ username: `u-${Math.random().toString(36).slice(2)}`, name: options.employee ? `${options.employee.firstName} ${options.employee.lastName}` : "Konto", roles: [role] });
  const employee = options.employee ? await env.db.employee.create({ data: { ...options.employee, userId: user.id } }) : null;
  await env.signIn(user);
  const { getSession } = await import("@/server/auth/session");
  const session = (await getSession())!;
  env.signOut();
  return { session, employeeId: employee?.id ?? null };
}

before(async () => {
  env = await createTestEnv();
  for (const key of ["office.time", "workshop.orders"]) await env.db.featureSetting.create({ data: { key, enabled: true, updatedByName: "test" } });
  ops = await import("./operations");
  queries = await import("./queries");
  orderOps = await import("@/modules/workshop/orders/operations");
  ({ session: staff, employeeId: staffEmployee } = (await sessionFor(STAFF, { employee: { firstName: "Tom", lastName: "Meyer" } })) as never);
  ({ session: staff2, employeeId: staff2Employee } = (await sessionFor(STAFF, { employee: { firstName: "Lena", lastName: "Hoffmann" } })) as never);
  manager = (await sessionFor(MANAGER, { employee: { firstName: "Chef", lastName: "Brandt" } })).session;
  noProfile = (await sessionFor(STAFF)).session;
  advisor = (await sessionFor(ADVISOR)).session;
  admin = (await sessionFor([], { admin: true })).session;
  vehicleId = (await env.db.vehicle.create({ data: { plate: "B AB 1", plateNorm: "BAB1" } })).id;
});
after(() => env.cleanup());

beforeEach(async () => {
  for (const table of ["timeCorrection", "timeEntry", "orderEvent", "orderItem", "order", "counter", "auditLog", "absence"] as const) await (env.db[table] as unknown as { deleteMany(): Promise<unknown> }).deleteMany();
  await env.db.workshop.upsert({ where: { id: "default" }, update: { hourlyRateCents: 9000, workUnitMinutes: 5 }, create: { id: "default", hourlyRateCents: 9000, workUnitMinutes: 5 } });
  await env.db.employee.updateMany({ data: { active: true } });
});

const today = () => dayKey(new Date());
const yesterday = () => addDaysToKey(today(), -1);
const times = (day: string, from: string, to: string, extra: Record<string, unknown> = {}) => ({ startDate: day, startTime: from, endDate: day, endTime: to, reason: "Stempeln vergessen", ...extra });
const entry = (id: string) => env.db.timeEntry.findUniqueOrThrow({ where: { id } });
const versionNow = async (id: string) => versionOf(await entry(id));
const newOrder = async (status = "in_progress") => {
  const created = out(await orderOps.createOrderOperation.execute(advisor, { vehicleId }));
  if (status !== "accepted") await env.db.order.update({ where: { id: created.id }, data: { status } });
  return created.id;
};

describe("Stempeln", () => {
  it("startet und beendet einen Eintrag; genau ein Eintrag läuft, der zweite Start scheitert", async () => {
    const started = out(await ops.startTimeOperation.execute(staff, { activity: "Bremsen" }));
    const running = await entry(started.id);
    assert.equal(running.runningKey, staffEmployee);
    assert.equal(running.endedAt, null);
    assert.equal(running.activity, "Bremsen");
    assert.equal(failure(await ops.startTimeOperation.execute(staff, {})).code, "duplicate");
    await env.db.timeEntry.update({ where: { id: started.id }, data: { startedAt: new Date(Date.now() - 3_600_000) } });
    out(await ops.stopTimeOperation.execute(staff, { breakMinutes: "10" }));
    const stopped = await entry(started.id);
    assert.ok(stopped.endedAt);
    assert.equal(stopped.runningKey, null);
    assert.equal(stopped.breakMinutes, 10);
    assert.equal(failure(await ops.stopTimeOperation.execute(staff, {})).key, "time.errors.notRunning", "es läuft nichts mehr");
    assert.ok((await env.db.auditLog.count({ where: { action: { in: ["time.start", "time.stop"] } } })) === 2);
  });

  it("Beenden mit einer Pause, die länger als die Dauer ist, wird abgelehnt – der Eintrag läuft weiter", async () => {
    const { session } = await sessionFor(STAFF, { employee: { firstName: "Pia", lastName: "Pause" } });
    const started = out(await ops.startTimeOperation.execute(session, {}));
    assert.equal(failure(await ops.stopTimeOperation.execute(session, { breakMinutes: "600" })).fields?.breakMinutes?.key, "time.errors.breakTooLong");
    assert.equal((await entry(started.id)).endedAt, null);
    out(await ops.stopTimeOperation.execute(session, {}));
  });

  it("gleichzeitiger Start (zwei Geräte, verschiedene Schlüssel): genau einer gelingt", async () => {
    const results = await Promise.all([ops.startTimeOperation.execute(staff, { key: "k-1" }), ops.startTimeOperation.execute(staff, { key: "k-2" }), ops.startTimeOperation.execute(staff, { key: "k-3" })]);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.ok(results.filter((r) => !r.ok).every((r) => !r.ok && r.failure.code === "duplicate"));
    assert.equal(await env.db.timeEntry.count({ where: { employeeId: staffEmployee } }), 1);
  });

  it("derselbe Schlüssel bucht nicht doppelt: Wiederholung von Start und Ende liefert denselben Eintrag", async () => {
    const first = out(await ops.startTimeOperation.execute(staff, { key: "start-1" }));
    const again = out(await ops.startTimeOperation.execute(staff, { key: "start-1" }));
    assert.equal(again.id, first.id);
    assert.equal(again.replayed, true);
    out(await ops.stopTimeOperation.execute(staff, { key: "stop-1" }));
    const stopAgain = out(await ops.stopTimeOperation.execute(staff, { key: "stop-1" }));
    assert.equal(stopAgain.id, first.id);
    assert.equal(stopAgain.replayed, true);
    assert.equal(await env.db.timeEntry.count(), 1);
    // ein Schlüssel einer anderen Person gilt nicht für diese
    assert.equal(failure(await ops.startTimeOperation.execute(staff2, { key: "start-1" })).code, "invalid");
  });

  it("ohne Mitarbeiterprofil oder mit ausgeschiedenem Mitarbeiter lässt sich nicht stempeln (Voraussetzung fehlt, 422 statt 403)", async () => {
    const none = failure(await ops.startTimeOperation.execute(noProfile, {}));
    assert.equal(none.code, "invalid");
    assert.equal(none.key, "time.errors.noEmployee");
    await env.db.employee.update({ where: { id: staffEmployee }, data: { active: false } });
    assert.equal(failure(await ops.startTimeOperation.execute(staff, {})).key, "time.errors.inactive");
  });

  it("ohne Recht time.stamp: abgelehnt", async () => {
    const reader = (await sessionFor(["time.view"], { employee: { firstName: "Nur", lastName: "Lesen" } })).session;
    assert.equal(failure(await ops.startTimeOperation.execute(reader, {})).code, "forbidden");
  });

  it("auf einen Auftrag stempeln: nur offen, ohne eingeschränkten Kunden und nur mit orders.view", async () => {
    const open = await newOrder();
    const started = out(await ops.startTimeOperation.execute(staff, { orderId: open }));
    assert.equal((await entry(started.id)).orderId, open);
    out(await ops.stopTimeOperation.execute(staff, {}));

    const closed = await newOrder("picked_up");
    assert.equal(failure(await ops.startTimeOperation.execute(staff, { orderId: closed })).fields?.orderId?.key, "time.errors.orderClosed");

    const customer = await env.db.customer.create({ data: { lastName: "Gesperrt", processingRestrictedAt: new Date() } });
    const restrictedVehicle = await env.db.vehicle.create({ data: { plate: "B XY 9", plateNorm: "BXY9", customerId: customer.id } });
    const restrictedOrder = await env.db.order.create({ data: { number: "A-X-1", vehicleId: restrictedVehicle.id, customerId: customer.id } });
    assert.equal(failure(await ops.startTimeOperation.execute(staff, { orderId: restrictedOrder.id })).fields?.orderId?.key, "time.errors.orderRestricted");

    const blind = (await sessionFor(["time.view", "time.stamp"], { employee: { firstName: "Ohne", lastName: "Aufträge" } })).session;
    assert.equal(failure(await ops.startTimeOperation.execute(blind, { orderId: open })).fields?.orderId?.key, "validation.invalid");
    assert.equal(failure(await ops.startTimeOperation.execute(staff, { orderId: "gibt-es-nicht" })).fields?.orderId?.key, "validation.invalid");
  });

  it("ein Eintrag, der über 24 Stunden läuft, lässt sich nicht mehr einfach beenden – er wird mit Begründung korrigiert", async () => {
    const started = out(await ops.startTimeOperation.execute(staff, {}));
    await env.db.timeEntry.update({ where: { id: started.id }, data: { startedAt: new Date(Date.now() - 30 * 3_600_000) } });
    assert.equal(failure(await ops.stopTimeOperation.execute(staff, {})).key, "time.errors.tooLong");
    const fixed = out(await ops.correctTimeOperation.execute(staff, { id: started.id, version: await versionNow(started.id), ...times(yesterday(), "08:00", "16:00", { breakMinutes: 30 }), reason: "Gehen nicht gestempelt" }));
    const row = await entry(fixed.id);
    assert.equal(row.runningKey, null, "durch das Ende ist der Eintrag nicht mehr laufend");
    out(await ops.startTimeOperation.execute(staff, {}));
  });
});

describe("Korrigieren, stornieren, nachtragen", () => {
  const manual = async (session = staff, day = yesterday(), from = "08:00", to = "12:00") => out(await ops.addManualTimeOperation.execute(session, times(day, from, to)));

  it("Nachtrag: Herkunft „nachgetragen“, Begründung im Verlauf, Dauer plausibel", async () => {
    const created = await manual();
    const row = await entry(created.id);
    assert.equal(row.source, "manual");
    assert.equal(row.endedAt!.getTime() - row.startedAt.getTime(), 4 * 3_600_000);
    const history = await env.db.timeCorrection.findMany({ where: { entryId: row.id } });
    assert.deepEqual(history.map((h) => [h.kind, h.reason]), [["create", "Stempeln vergessen"]]);
    assert.equal((await env.db.auditLog.count({ where: { action: "time.manual" } })), 1);
  });

  it("ohne Begründung (oder zu kurz), in der Zukunft, mit Ende vor Beginn und mit zu langer Pause: Feldfehler", async () => {
    assert.ok(failure(await ops.addManualTimeOperation.execute(staff, times(yesterday(), "08:00", "12:00", { reason: "" }))).fields?.reason);
    assert.ok(failure(await ops.addManualTimeOperation.execute(staff, times(yesterday(), "08:00", "12:00", { reason: "kurz" }))).fields?.reason);
    assert.equal(failure(await ops.addManualTimeOperation.execute(staff, times(addDaysToKey(today(), 3), "08:00", "12:00"))).fields?.startTime?.key, "time.errors.future");
    assert.equal(failure(await ops.addManualTimeOperation.execute(staff, times(yesterday(), "12:00", "08:00"))).fields?.endTime?.key, "time.errors.endBeforeStart");
    assert.equal(failure(await ops.addManualTimeOperation.execute(staff, times(yesterday(), "08:00", "09:00", { breakMinutes: 90 }))).fields?.breakMinutes?.key, "time.errors.breakTooLong");
    assert.equal(failure(await ops.addManualTimeOperation.execute(staff, { startDate: yesterday(), startTime: "08:00", reason: "Stempeln vergessen" })).fields?.endDate?.key, "validation.required");
  });

  it("Korrektur ändert unveränderte Zeitpunkte nicht – auch nicht in der doppelten Stunde der Zeitumstellung (02:30 gibt es zweimal)", async () => {
    await withWorkshopZone("Europe/Berlin", async () => {
      const second = new Date(Date.UTC(2026, 9, 25, 1, 30)); // 02:30 MEZ, die zweite 02:30
      const row = await env.db.timeEntry.create({ data: { employeeId: staffEmployee, startedAt: second, endedAt: new Date(Date.UTC(2026, 9, 25, 3, 30)), breakMinutes: 0, source: "manual" } });
      out(await ops.correctTimeOperation.execute(staff, { id: row.id, version: versionOf(row), startDate: "2026-10-25", startTime: "02:30", endDate: "2026-10-25", endTime: "04:30", breakMinutes: "15", reason: "Pause nachgetragen" }));
      const after = await entry(row.id);
      assert.equal(after.startedAt.getTime(), second.getTime());
      assert.equal(after.endedAt!.getTime(), Date.UTC(2026, 9, 25, 3, 30));
      assert.equal(after.breakMinutes, 15);
      // ein geänderter Wert wird dagegen neu gelesen
      out(await ops.correctTimeOperation.execute(staff, { id: row.id, version: await versionNow(row.id), startDate: "2026-10-25", startTime: "03:00", endDate: "2026-10-25", endTime: "04:30", breakMinutes: "0", reason: "Beginn geändert" }));
      assert.equal(timeKey((await entry(row.id)).startedAt), "03:00");
      await env.db.timeEntry.delete({ where: { id: row.id } }).catch(() => undefined);
    });
  });

  it("Überschneidungen werden abgelehnt (auch gegen den laufenden Eintrag), Anschluss ohne Lücke ist erlaubt", async () => {
    await manual(staff, yesterday(), "08:00", "12:00");
    assert.equal(failure(await ops.addManualTimeOperation.execute(staff, times(yesterday(), "11:00", "13:00"))).key, "time.errors.overlap");
    await manual(staff, yesterday(), "12:00", "13:00");
    out(await ops.startTimeOperation.execute(staff, {}));
    // ein Nachtrag, der in den laufenden Eintrag hineinreicht (Ende kurz in der Zukunft ist erlaubt)
    const from = new Date(Date.now() - 60_000);
    const to = new Date(Date.now() + 2 * 60_000);
    if (dayKey(from) === dayKey(to)) assert.equal(failure(await ops.addManualTimeOperation.execute(staff, times(dayKey(from), timeKey(from), timeKey(to)))).key, "time.errors.overlap");
  });

  it("Korrektur: Pflicht-Begründung, der Stand davor bleibt im Verlauf, Version schützt vor Überschreiben", async () => {
    const created = await manual();
    const before = await entry(created.id);
    const version = versionOf(before);
    assert.ok(failure(await ops.correctTimeOperation.execute(staff, { id: created.id, version, ...times(yesterday(), "08:00", "13:00", { reason: "" }) })).fields?.reason);
    out(await ops.correctTimeOperation.execute(staff, { id: created.id, version, ...times(yesterday(), "08:30", "13:00", { breakMinutes: 15, activity: "Räder", reason: "Beginn war 08:30" }) }));
    const row = await entry(created.id);
    assert.equal(timeKey(row.startedAt), "08:30");
    assert.equal(timeKey(row.endedAt!), "13:00");
    assert.equal(row.breakMinutes, 15);
    const history = await env.db.timeCorrection.findMany({ where: { entryId: created.id, kind: "edit" } });
    assert.equal(history.length, 1);
    assert.equal(history[0].reason, "Beginn war 08:30");
    assert.equal(history[0].prevStartedAt!.getTime(), before.startedAt.getTime());
    assert.equal(history[0].prevEndedAt!.getTime(), before.endedAt!.getTime());
    // dieselbe (nun veraltete) Version nochmals: Konflikt, nichts überschrieben
    assert.equal(failure(await ops.correctTimeOperation.execute(staff, { id: created.id, version, ...times(yesterday(), "09:00", "10:00", { reason: "zweiter Versuch" }) })).code, "conflict");
    assert.equal(timeKey((await entry(created.id)).startedAt), "08:30");
    assert.equal(await env.db.auditLog.count({ where: { action: "time.correct" } }), 1);
  });

  it("fremde Einträge: ohne time.correctAll gibt es sie nicht (notFound), mit dem Recht lassen sie sich korrigieren, stornieren und nachtragen", async () => {
    const mine = await manual(staff);
    const version = await versionNow(mine.id);
    assert.equal(failure(await ops.correctTimeOperation.execute(staff2, { id: mine.id, version, ...times(yesterday(), "09:00", "10:00", { reason: "fremder Versuch" }) })).code, "notFound");
    assert.equal(failure(await ops.voidTimeOperation.execute(staff2, { id: mine.id, version, reason: "fremder Versuch" })).code, "notFound");
    assert.equal(failure(await ops.addManualTimeOperation.execute(staff2, times(yesterday(), "14:00", "15:00", { employeeId: staffEmployee }))).code, "forbidden");
    out(await ops.correctTimeOperation.execute(manager, { id: mine.id, version, ...times(yesterday(), "08:00", "11:00", { reason: "Leitung korrigiert" }) }));
    const other = out(await ops.addManualTimeOperation.execute(manager, times(yesterday(), "14:00", "15:00", { employeeId: staff2Employee })));
    assert.equal((await entry(other.id)).employeeId, staff2Employee);
    out(await ops.voidTimeOperation.execute(manager, { id: other.id, version: await versionNow(other.id), reason: "Irrtum der Leitung" }));
    assert.ok((await entry(other.id)).voidedAt);
  });

  it("Stornieren: bleibt mit Begründung im Verlauf, zählt nicht mehr, lässt sich nicht erneut ändern", async () => {
    const created = await manual();
    out(await ops.voidTimeOperation.execute(staff, { id: created.id, version: await versionNow(created.id), reason: "Doppelt gebucht" }));
    const row = await entry(created.id);
    assert.ok(row.voidedAt);
    assert.deepEqual((await env.db.timeCorrection.findMany({ where: { entryId: created.id }, orderBy: { at: "asc" } })).map((c) => c.kind).sort(), ["create", "void"]);
    assert.equal(failure(await ops.correctTimeOperation.execute(staff, { id: created.id, version: versionOf(row), ...times(yesterday(), "08:00", "09:00", { reason: "nochmal" }) })).key, "time.errors.voided");
    assert.equal((await queries.listEntries(staff, { from: yesterday(), to: today() })).length, 0);
    assert.equal((await queries.listEntries(staff, { from: yesterday(), to: today(), includeVoided: true })).length, 1);
    // der Zeitraum ist wieder frei
    await manual();
  });

  it("Zeit-Einträge werden nie gelöscht: die Mitarbeiter-Löschung scheitert (inUse), solange es Einträge gibt", async () => {
    await manual();
    const { deleteEmployeeOperation } = await import("@/modules/office/employees/operations");
    const hr = (await sessionFor(["employees.view", "employees.delete"])).session;
    assert.equal(failure(await deleteEmployeeOperation.execute(hr, { id: staffEmployee })).code, "inUse");
    assert.ok(await env.db.employee.findUnique({ where: { id: staffEmployee } }));
  });
});

describe("Sichtbarkeit", () => {
  it("mit time.view nur die eigenen Zeiten, mit time.viewAll alle (Filter nach Mitarbeiter)", async () => {
    const a = out(await ops.addManualTimeOperation.execute(staff, times(yesterday(), "08:00", "12:00")));
    const b = out(await ops.addManualTimeOperation.execute(staff2, times(yesterday(), "08:00", "12:00")));
    assert.deepEqual((await queries.listEntries(staff, { from: yesterday(), to: today() })).map((r) => r.id), [a.id]);
    assert.deepEqual((await queries.listEntries(staff, { from: yesterday(), to: today(), employeeId: staff2Employee })).map((r) => r.id), [a.id], "der Filter schaltet fremde Zeiten nicht frei");
    const all = await queries.listEntries(manager, { from: yesterday(), to: today() });
    assert.deepEqual(all.map((r) => r.id).sort(), [a.id, b.id].sort());
    assert.ok(all.every((r) => r.employeeName));
    assert.deepEqual((await queries.listEntries(manager, { from: yesterday(), to: today(), employeeId: staff2Employee })).map((r) => r.id), [b.id]);
    assert.equal(await queries.getEntry(staff, b.id), null);
    assert.equal((await queries.getEntry(manager, b.id))?.id, b.id);
    assert.deepEqual((await queries.searchEntries(staff, "Stempeln", 10)).length, 0, "Suche liest Tätigkeit und Notiz, nicht die Begründung");
  });

  it("ohne Mitarbeiterprofil gibt es nichts zu sehen; Teamübersicht verlangt time.viewAll", async () => {
    assert.deepEqual(await queries.listEntries(noProfile, { from: yesterday(), to: today() }), []);
    await assert.rejects(queries.teamWeek(staff, today()), /time.viewAll/);
    const team = await queries.teamWeek(manager, today());
    assert.ok(team.rows.some((r) => r.employeeId === staffEmployee));
  });

  it("die Auftragssumme zählt alle Mitarbeiter (nur Zahlen), die Einzelzeilen nur die eigenen – mit viewAll alle", async () => {
    const order = await newOrder();
    out(await ops.addManualTimeOperation.execute(staff, times(yesterday(), "08:00", "10:00", { orderId: order })));
    out(await ops.addManualTimeOperation.execute(staff2, times(yesterday(), "08:00", "09:30", { orderId: order })));
    const mine = await queries.orderTimes(staff, order);
    assert.equal(mine.totalMinutes, 210);
    assert.equal(mine.entries.length, 1);
    assert.ok(mine.entries.every((e) => e.employeeName === null || e.own));
    const all = await queries.orderTimes(manager, order);
    assert.equal(all.entries.length, 2);
  });
});

describe("Woche: Ist, Soll, Saldo", () => {
  it("Abwesenheit und Feiertag senken das Soll; die Zeiterfassung erfährt keinen Grund", async () => {
    // feste Woche (Montag 2. bis Freitag 6. März 2026, ohne Feiertag): das Ergebnis hängt nicht vom Tag des Testlaufs ab (Feiertage, Wochenbeginn)
    const monday = "2026-03-02";
    await env.db.absence.create({ data: { employeeId: staffEmployee, type: "sick", startDate: parseZoned(monday, "12:00")!, endDate: parseZoned(monday, "12:00")!, note: "geheim" } });
    out(await ops.addManualTimeOperation.execute(staff, times(addDaysToKey(monday, 1), "08:00", "12:00")));
    const view = await queries.weekFor({ id: staffEmployee, workWeekdays: "1,2,3,4,5" }, monday);
    assert.equal(view.week.days[0].absent, true);
    assert.equal(view.week.days[0].target, 0);
    assert.equal(view.week.days[1].target, 480);
    assert.ok(!JSON.stringify(view).includes("sick") && !JSON.stringify(view).includes("geheim"));
  });
});

describe("Zeiten als Positionen übernehmen", () => {
  const done = async (order: string, session = staff, day = yesterday(), from = "08:00", to = "09:30", extra: Record<string, unknown> = {}) => out(await ops.addManualTimeOperation.execute(session, times(day, from, to, { orderId: order, ...extra })));

  it("legt je Eintrag eine Arbeitsposition zum Stundensatz an, markiert die Einträge und ist idempotent", async () => {
    const order = await newOrder();
    const a = await done(order, staff, yesterday(), "08:00", "09:30", { activity: "Bremsen" });
    const b = await done(order, staff2, yesterday(), "08:00", "09:00");
    const result = out(await ops.transferTimeOperation.execute(advisor, { orderId: order, unit: "h", label: "Arbeitszeit" }));
    assert.deepEqual([result.entries, result.positions, result.minutes], [2, 2, 150]);
    const items = await env.db.orderItem.findMany({ where: { orderId: order }, orderBy: { position: "asc" } });
    assert.equal(items.length, 2);
    const first = items.find((i) => i.refId === a.id)!;
    assert.equal(first.refType, "time");
    assert.equal(first.kind, "labor");
    assert.equal(first.unit, "h");
    assert.equal(first.quantityMilli, 1500);
    assert.equal(first.unitCents, 9000);
    assert.match(first.description, /Arbeitszeit – Bremsen \(\d{4}-\d{2}-\d{2}\)/);
    assert.ok(!items.some((i) => /Meyer|Hoffmann|Tom|Lena/.test(i.description)), "keine Namen in den Positionen");
    const rowA = await entry(a.id);
    assert.ok(rowA.transferredAt && rowA.transferredItemId === first.id);
    assert.ok((await entry(b.id)).transferredAt);
    // zweiter Aufruf: nichts mehr zu übernehmen, keine Dubletten
    assert.equal(failure(await ops.transferTimeOperation.execute(advisor, { orderId: order, unit: "h" })).key, "time.errors.nothingToTransfer");
    assert.equal(await env.db.orderItem.count({ where: { orderId: order } }), 2);
    // übernommene Zeiten sind gesperrt
    assert.equal(failure(await ops.correctTimeOperation.execute(staff, { id: a.id, version: versionOf(rowA), ...times(yesterday(), "08:00", "10:00", { reason: "nachträglich" }) })).key, "time.errors.transferred");
    assert.equal(failure(await ops.voidTimeOperation.execute(staff, { id: a.id, version: versionOf(rowA), reason: "nachträglich" })).key, "time.errors.transferred");
    assert.equal(await env.db.auditLog.count({ where: { action: "time.transfer" } }), 1);
  });

  it("Position im Auftrag gelöscht: die Zeit ist wieder übernehmbar; behaltene Positionen führen die Kennung nach; Verweise auf fremde oder nicht übernommene Zeiten werden abgelehnt", async () => {
    const order = await newOrder();
    const a = await done(order, staff, yesterday(), "08:00", "09:00", { activity: "Bremsen" });
    const b = await done(order, staff2, yesterday(), "10:00", "11:00");
    out(await ops.transferTimeOperation.execute(advisor, { orderId: order, unit: "h", label: "Arbeitszeit" }));
    const save = async (items: unknown[]) => orderOps.saveItemsOperation.execute(advisor, { id: order, version: versionOf(await env.db.order.findUniqueOrThrow({ where: { id: order } })), items: JSON.stringify(items) });
    const line = (refId: string) => ({ description: "Arbeitszeit", unit: "h", quantityMilli: 1000, unitCents: 9000, taxBp: 1900, kind: "labor", refType: "time", refId });
    // eine Position bleibt (neue Kennung), die andere entfällt
    out(await save([line(a.id)]));
    const kept = await env.db.orderItem.findFirstOrThrow({ where: { orderId: order, refId: a.id } });
    assert.equal((await entry(a.id)).transferredItemId, kept.id);
    assert.ok((await entry(a.id)).transferredAt);
    const freed = await entry(b.id);
    assert.equal(freed.transferredAt, null);
    assert.equal(freed.transferredItemId, null);
    // die freigewordene Zeit lässt sich erneut übernehmen, und sie ist wieder korrigierbar
    assert.equal(failure(await ops.correctTimeOperation.execute(staff, { id: a.id, version: await versionNow(a.id), ...times(yesterday(), "08:00", "10:00", { reason: "x1234" }) })).key, "time.errors.transferred");
    out(await ops.correctTimeOperation.execute(staff2, { id: b.id, version: versionOf(freed), ...times(yesterday(), "10:00", "11:30", { reason: "länger gearbeitet", orderId: order }) }));
    const again = out(await ops.transferTimeOperation.execute(advisor, { orderId: order, unit: "h", label: "Arbeitszeit" }));
    assert.deepEqual([again.entries, again.positions, again.minutes], [1, 1, 90]);
    // alle Positionen weg: beide Zeiten frei
    out(await save([]));
    assert.equal(await env.db.timeEntry.count({ where: { orderId: order, transferredAt: { not: null } } }), 0);
    // Verweise: nicht übernommen, fremder Auftrag, doppelt, erfunden
    const other = await newOrder();
    const foreign = await done(other, staff, yesterday(), "12:00", "13:00");
    out(await ops.transferTimeOperation.execute(advisor, { orderId: other }));
    for (const refId of [a.id, foreign.id, "erfunden"]) assert.ok(failure(await save([line(refId)])).fields?.["items.0.refId"], refId);
    out(await ops.transferTimeOperation.execute(advisor, { orderId: order, unit: "h" }));
    assert.ok(failure(await save([line(a.id), line(a.id)])).fields?.["items.1.refId"], "doppelt");
    assert.equal(await env.db.orderItem.count({ where: { orderId: order, refType: "time" } }), 2, "abgelehnte Speicherung ändert nichts");
  });

  it("Arbeitswerte: Menge in AW (Minuten aus dem Profil), Satz je AW", async () => {
    const order = await newOrder();
    await done(order, staff, yesterday(), "08:00", "09:00");
    out(await ops.transferTimeOperation.execute(advisor, { orderId: order, unit: "aw", label: "Arbeitszeit" }));
    const item = await env.db.orderItem.findFirstOrThrow({ where: { orderId: order } });
    assert.equal(item.unit, "AW");
    assert.equal(item.quantityMilli, 12_000);
    assert.equal(item.unitCents, 750);
  });

  it("gleichzeitige Übernahme: genau eine gelingt, nie doppelte Positionen", async () => {
    const order = await newOrder();
    await done(order, staff, yesterday(), "08:00", "09:00");
    await done(order, staff2, yesterday(), "08:00", "09:00");
    const results = await Promise.all([ops.transferTimeOperation.execute(advisor, { orderId: order }), ops.transferTimeOperation.execute(admin, { orderId: order }), ops.transferTimeOperation.execute(advisor, { orderId: order })]);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(await env.db.orderItem.count({ where: { orderId: order } }), 2);
  });

  it("Rechte und Sperren: ohne orders.prices/orders.edit, ohne Stundensatz, abgeschlossener Auftrag; Positionen heben die Version des Auftrags", async () => {
    const order = await newOrder();
    await done(order);
    assert.equal(failure(await ops.transferTimeOperation.execute(staff, { orderId: order })).code, "forbidden", "Mechaniker ohne Preise");
    await env.db.workshop.update({ where: { id: "default" }, data: { hourlyRateCents: null } });
    assert.equal(failure(await ops.transferTimeOperation.execute(advisor, { orderId: order })).key, "time.errors.noRate");
    await env.db.workshop.update({ where: { id: "default" }, data: { hourlyRateCents: 9000 } });
    const versionBefore = versionOf(await env.db.order.findUniqueOrThrow({ where: { id: order } }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    out(await ops.transferTimeOperation.execute(advisor, { orderId: order }));
    assert.notEqual(versionOf(await env.db.order.findUniqueOrThrow({ where: { id: order } })), versionBefore, "ein offenes Bearbeiten-Formular meldet danach einen Konflikt");

    const closed = await newOrder();
    await done(closed, staff, addDaysToKey(today(), -3));
    await env.db.order.update({ where: { id: closed }, data: { status: "picked_up" } });
    assert.equal(failure(await ops.transferTimeOperation.execute(advisor, { orderId: closed })).key, "orders.errors.closed");
    assert.equal(await env.db.orderItem.count({ where: { orderId: closed } }), 0);
    assert.equal((await env.db.timeEntry.findMany({ where: { orderId: closed } })).every((e) => e.transferredAt === null), true, "nichts markiert, wenn die Übernahme scheitert");
  });

  it("laufende Einträge bleiben unberührt; Einträge mit 0 Minuten werden markiert, aber nicht abgerechnet", async () => {
    const order = await newOrder();
    await done(order, staff, yesterday(), "08:00", "08:10", { breakMinutes: 10 });
    out(await ops.startTimeOperation.execute(staff2, { orderId: order }));
    const result = out(await ops.transferTimeOperation.execute(advisor, { orderId: order }));
    assert.deepEqual([result.entries, result.positions], [1, 0]);
    assert.ok((await env.db.timeEntry.findFirstOrThrow({ where: { orderId: order, endedAt: null } })).transferredAt === null);
  });
});

describe("Einstellungen", () => {
  it("Sollzeit nur mit settings.manage, mit Grenzen", async () => {
    assert.equal(failure(await ops.saveTimeSettingsOperation.execute(staff, { dailyTargetMinutes: "480" })).code, "forbidden");
    assert.ok(failure(await ops.saveTimeSettingsOperation.execute(admin, { dailyTargetMinutes: "5" })).fields?.dailyTargetMinutes);
    out(await ops.saveTimeSettingsOperation.execute(admin, { dailyTargetMinutes: "420" }));
    assert.equal((await env.db.timeSettings.findUniqueOrThrow({ where: { id: "default" } })).dailyTargetMinutes, 420);
    await env.db.timeSettings.deleteMany();
  });
});
