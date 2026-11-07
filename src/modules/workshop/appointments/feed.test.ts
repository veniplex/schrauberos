import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import type { AppSession } from "@/server/auth/session";
import type { Outcome } from "@/server/operations/operation";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Kalender-Abo (F10) gegen eine echte temporäre SQLite: Lebenszyklus des Tokens (erzeugen, erneuern, widerrufen – mit Passwortabfrage, nur der Hash gespeichert), 401 mit identischer Antwort für alle
 * Ablehnungsgründe, Drosselung nur im Fehlerpfad, wirksame Rechte des Besitzers bei jedem Abruf, Art. 18, Abwesenheiten nur als „abwesend“, nichts Internes im Feed, Umfang und Obergrenze.
 */
let env: TestEnv;
let feed: typeof import("./feed");
let state: typeof import("./feed-state");
let ops: typeof import("./operations");
let route: typeof import("@/app/api/ical/[file]/route");

const NOW = new Date("2026-11-07T10:20:00Z");
const PASSWORD = "geheim-passwort-123";
const ALL = ["appointments.view", "customers.view", "employees.view", "vehicles.view", "fleet.view"];

const out = <T>(outcome: Outcome<T>): T => {
  assert.ok(outcome.ok, JSON.stringify(!outcome.ok && outcome.failure));
  return outcome.data;
};

let counter = 0;
async function owner(permissions: readonly string[], extra: { active?: boolean; mustChangePassword?: boolean } = {}) {
  const role = await env.role({ permissions });
  const user = await env.user({ username: `f-${++counter}`, name: `Person ${counter}`, password: PASSWORD, active: extra.active, mustChangePassword: extra.mustChangePassword, roles: [role] });
  await env.signIn(user);
  const session = (await (await import("@/server/auth/session")).getSession())!;
  env.signOut();
  return { user, session };
}
/** Legt das Token direkt an (auch für Konten ohne `appointments.view`, die über die Operation keines bekämen – etwa nach einer Rechteänderung). */
async function plant(userId: string): Promise<string> {
  const { generateFeedToken, hashFeedToken, feedTokenHint } = await import("./feed-token");
  const token = generateFeedToken();
  await env.db.calendarFeedToken.create({ data: { userId, tokenHash: hashFeedToken(token), hint: feedTokenHint(token) } });
  return token;
}
/** Erzeugt die Abo-Adresse über die echte Operation und liefert das Token. */
async function subscribe(session: AppSession, expires: "never" | "90" | "365" = "never") {
  return out(await ops.createFeedOperation.execute(session, { password: PASSWORD, expires })).token;
}
const call = async (file: string, headers: Record<string, string> = {}) => route.GET(new NextRequest(`http://localhost/api/ical/${file}`, { headers }), { params: Promise.resolve({ file }) });
const body = async (res: Response) => (await res.text()).replace(/\r\n[ \t]/g, "");
const events = (text: string) => text.split("\r\n").filter((l) => l === "BEGIN:VEVENT").length;
const summaries = (text: string) => text.split("\r\n").filter((l) => l.startsWith("SUMMARY:")).map((l) => l.slice(8));

before(async () => {
  env = await createTestEnv();
  feed = await import("./feed");
  state = await import("./feed-state");
  ops = await import("./operations");
  route = await import("@/app/api/ical/[file]/route");
  state.feedRuntime.now = () => NOW.getTime();
});
after(async () => {
  state.feedRuntime.now = () => Date.now();
  await env.cleanup();
});
beforeEach(() => {
  state.resetFeedLimiters();
  env.signOut();
});

describe("Token: erzeugen, erneuern, widerrufen", () => {
  it("nur mit Passwortabfrage: falsches Passwort legt nichts an; der Klartext wird nie gespeichert (nur der Hash)", async () => {
    const { session, user } = await owner(["appointments.view"]);
    const wrong = await ops.createFeedOperation.execute(session, { password: "falsch", expires: "never" });
    assert.ok(!wrong.ok);
    assert.equal(await env.db.calendarFeedToken.count({ where: { userId: user.id } }), 0);

    const token = await subscribe(session);
    assert.match(token, /^cal_[A-Za-z0-9_-]{43}$/);
    const row = await env.db.calendarFeedToken.findUniqueOrThrow({ where: { userId: user.id } });
    const { createHash } = await import("node:crypto");
    assert.equal(row.tokenHash, createHash("sha256").update(token).digest("hex"));
    assert.ok(!JSON.stringify(row).includes(token), "der Klartext steht nirgends in der Zeile");
    assert.equal(row.hint, `${token.slice(0, 8)}…`);
    assert.equal(row.expiresAt, null);
    const audit = await env.db.auditLog.findFirstOrThrow({ where: { action: "appointment.feedCreate" }, orderBy: { createdAt: "desc" } });
    assert.ok(!JSON.stringify(audit).includes(token), "auch nicht im Audit-Log");
  });

  it("ein Token je Benutzer: Erneuern ersetzt das alte (das sofort 401 liefert); Ablauf optional", async () => {
    const { session, user } = await owner(["appointments.view"]);
    const first = await subscribe(session);
    assert.equal((await call(`${first}.ics`)).status, 200);
    const second = await subscribe(session, "90");
    assert.notEqual(first, second);
    assert.equal(await env.db.calendarFeedToken.count({ where: { userId: user.id } }), 1);
    assert.equal((await call(`${first}.ics`)).status, 401, "das alte Token ist ungültig");
    assert.equal((await call(`${second}.ics`)).status, 200);
    const row = await env.db.calendarFeedToken.findUniqueOrThrow({ where: { userId: user.id } });
    assert.equal(row.expiresAt?.getTime() !== undefined && row.expiresAt.getTime() > Date.now() + 80 * 86_400_000, true, "90 Tage ab jetzt");
    assert.match((await env.db.auditLog.findFirstOrThrow({ where: { action: "appointment.feedCreate" }, orderBy: { createdAt: "desc" } })).target ?? "", /\(ersetzt\)$/);
  });

  it("Widerrufen verlangt ebenfalls das Passwort, löscht die Zeile und macht die Adresse ungültig; ohne Abo ist es ein Fehler", async () => {
    const { session, user } = await owner(["appointments.view"]);
    assert.ok(!(await ops.revokeFeedOperation.execute(session, { password: PASSWORD })).ok, "ohne Abo gibt es nichts zu widerrufen");
    const token = await subscribe(session);
    assert.ok(!(await ops.revokeFeedOperation.execute(session, { password: "falsch" })).ok);
    assert.equal((await call(`${token}.ics`)).status, 200, "mit falschem Passwort bleibt es gültig");
    out(await ops.revokeFeedOperation.execute(session, { password: PASSWORD }));
    assert.equal(await env.db.calendarFeedToken.count({ where: { userId: user.id } }), 0);
    assert.equal((await call(`${token}.ics`)).status, 401);
  });

  it("ohne `appointments.view` gibt es kein Abo; ein abgelaufenes Token liefert 401", async () => {
    const { session } = await owner(["vehicles.view"]);
    assert.ok(!(await ops.createFeedOperation.execute(session, { password: PASSWORD, expires: "never" })).ok);
    const holder = await owner(["appointments.view"]);
    const token = await subscribe(holder.session, "90");
    await env.db.calendarFeedToken.update({ where: { userId: holder.user.id }, data: { expiresAt: new Date(NOW.getTime() - 1000) } });
    assert.equal((await call(`${token}.ics`)).status, 401);
  });

  it("Passwortwechsel, Deaktivierung und Notzugang (`revokeAccess`) löschen die Abo-Adresse", async () => {
    const { session, user } = await owner(["appointments.view"]);
    const token = await subscribe(session);
    const { revokeAccess } = await import("@/server/auth/revoke");
    await revokeAccess(env.db, user.id);
    assert.equal(await env.db.calendarFeedToken.count({ where: { userId: user.id } }), 0);
    assert.equal((await call(`${token}.ics`)).status, 401);
  });
});

describe("401 und Drosselung", () => {
  it("unbekannt, falsche Form, abgelaufen, widerrufen, Konto gesperrt, Passwortwechsel ausstehend: alles dieselbe Antwort", async () => {
    const good = await owner(["appointments.view"]);
    const goodToken = await subscribe(good.session);
    const inactive = await owner(["appointments.view"]);
    const inactiveToken = await subscribe(inactive.session);
    await env.db.user.update({ where: { id: inactive.user.id }, data: { active: false } });
    const mustChange = await owner(["appointments.view"]);
    const mustChangeToken = await subscribe(mustChange.session);
    await env.db.user.update({ where: { id: mustChange.user.id }, data: { mustChangePassword: true } });
    const expired = await owner(["appointments.view"]);
    const expiredToken = await subscribe(expired.session, "90");
    await env.db.calendarFeedToken.update({ where: { userId: expired.user.id }, data: { expiresAt: new Date(NOW.getTime() - 1000) } });
    const revoked = await owner(["appointments.view"]);
    const revokedToken = await subscribe(revoked.session);
    await env.db.calendarFeedToken.delete({ where: { userId: revoked.user.id } });

    assert.equal((await call(`${goodToken}.ics`)).status, 200);
    const attempts = ["cal_" + "x".repeat(43) + ".ics", "kaputt.ics", `${goodToken}`, `${goodToken}.ICS`, `${inactiveToken}.ics`, `${mustChangeToken}.ics`, `${expiredToken}.ics`, `${revokedToken}.ics`, `${"cal_" + "A".repeat(500)}.ics`];
    const results = [];
    for (const file of attempts) {
      const res = await call(file);
      results.push({ file: file.slice(0, 12), status: res.status, text: await res.text(), headers: [...res.headers.entries()].filter(([name]) => name !== "retry-after").sort() });
    }
    for (const r of results) {
      assert.equal(r.status, 401, r.file);
      assert.equal(r.text, results[0].text, r.file);
      assert.deepEqual(r.headers, results[0].headers, r.file);
    }
    assert.equal(results[0].headers.some(([name]) => name === "www-authenticate"), false, "kein Passwortdialog im Kalenderprogramm");
    assert.equal(results[0].headers.some(([name, value]) => name === "cache-control" && value === "no-store"), true);
  });

  it("Drosselung nur im Fehlerpfad: ungültige Aufrufe laufen in 429, gültige Abrufe zählen nie mit und werden nie gedrosselt", async () => {
    const { session } = await owner(["appointments.view"]);
    const token = await subscribe(session);
    state.feedLimits.failuresGlobal = 5;
    for (let i = 0; i < 40; i++) assert.equal((await call(`${token}.ics`)).status, 200, `gültiger Abruf ${i}`);
    for (let i = 0; i < 5; i++) assert.equal((await call(`cal_${"y".repeat(43)}.ics`)).status, 401);
    const limited = await call(`cal_${"y".repeat(43)}.ics`);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) >= 1);
    assert.equal((await call(`${token}.ics`)).status, 200, "ein gültiges Token wird von einer Flut ungültiger nicht ausgebremst");
  });

  it("je Adresse nur mit Reverse-Proxy-Einstellung; ohne sie ist X-Forwarded-For wirkungslos (nicht fälschbar)", async () => {
    state.feedLimits.failuresPerIp = 2;
    const bad = `cal_${"z".repeat(43)}.ics`;
    for (let i = 0; i < 6; i++) assert.equal((await call(bad, { "x-forwarded-for": "203.0.113.9" })).status, 401, "ohne Proxy-Einstellung nie je Adresse");
    state.resetFeedLimiters();
    state.feedLimits.failuresPerIp = 2;
    await env.db.appSetting.upsert({ where: { key: "auth.behindProxy" }, update: { value: "true" }, create: { key: "auth.behindProxy", value: "true" } });
    try {
      assert.equal((await call(bad, { "x-forwarded-for": "203.0.113.9" })).status, 401);
      assert.equal((await call(bad, { "x-forwarded-for": "203.0.113.9" })).status, 401);
      assert.equal((await call(bad, { "x-forwarded-for": "203.0.113.9" })).status, 429);
      assert.equal((await call(bad, { "x-forwarded-for": "203.0.113.10" })).status, 401, "andere Adresse, anderes Konto");
    } finally {
      await env.db.appSetting.deleteMany({ where: { key: "auth.behindProxy" } });
    }
  });

  it("das Sitzungs-Cookie spielt keine Rolle: mit Sitzung und ungültigem Token 401, ohne Sitzung mit gültigem Token 200; die Antwort setzt kein Cookie", async () => {
    const { session, user } = await owner(["appointments.view"]);
    const token = await subscribe(session);
    await env.signIn(user);
    assert.equal((await call("cal_" + "q".repeat(43) + ".ics")).status, 401);
    env.signOut();
    const res = await call(`${token}.ics`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("set-cookie"), null);
  });
});

describe("Antwort", () => {
  it("Kopfzeilen: text/calendar, Cache-Control private/no-store, nosniff, kein Referrer; Inhalt ist ein gültiger Kalender mit CRLF", async () => {
    const { session } = await owner(["appointments.view"]);
    const token = await subscribe(session);
    const res = await call(`${token}.ics`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/calendar; charset=utf-8");
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    const text = await res.text();
    assert.ok(text.startsWith("BEGIN:VCALENDAR\r\n") && text.endsWith("END:VCALENDAR\r\n"));
    assert.ok(!/(^|[^\r])\n/.test(text));
  });

  it("zuletzt benutzt wird auf die Stunde gerundet und höchstens einmal je Stunde geschrieben", async () => {
    const { session, user } = await owner(["appointments.view"]);
    const token = await subscribe(session);
    const last = async () => (await env.db.calendarFeedToken.findUniqueOrThrow({ where: { userId: user.id } })).lastUsedAt;
    assert.equal(await last(), null);
    await call(`${token}.ics`);
    assert.equal((await last())?.toISOString(), "2026-11-07T10:00:00.000Z", "10:20 → 10:00");
    state.feedRuntime.now = () => new Date("2026-11-07T10:55:00Z").getTime();
    await call(`${token}.ics`);
    assert.equal((await last())?.toISOString(), "2026-11-07T10:00:00.000Z", "innerhalb derselben Stunde keine neue Schreibung");
    state.feedRuntime.now = () => new Date("2026-11-07T11:05:00Z").getTime();
    await call(`${token}.ics`);
    assert.equal((await last())?.toISOString(), "2026-11-07T11:00:00.000Z");
    state.feedRuntime.now = () => NOW.getTime();
  });
});

describe("Inhalt und Rechte des Besitzers", () => {
  let vehicleId: string;
  before(async () => {
    const erika = await env.db.customer.create({ data: { firstName: "Erika", lastName: "Muster", phone: "0151 123456", nameKey: "erika muster" } });
    const restricted = await env.db.customer.create({ data: { lastName: "Gesperrt", processingRestrictedAt: new Date() } });
    const car = await env.db.vehicle.create({ data: { plate: "B-AB 1234", plateNorm: "BAB1234", make: "VW", model: "Golf", customerId: erika.id, inspectionDue: "2026-12", extraInspectionKind: "gas", extraInspectionDue: new Date("2027-02-14T11:00:00Z") } });
    vehicleId = car.id;
    const lockedCar = await env.db.vehicle.create({ data: { plate: "B-GS 9", plateNorm: "BGS9", customerId: restricted.id, inspectionDue: "2026-12" } });
    await env.db.vehicle.create({ data: { plate: "B-AR 1", plateNorm: "BAR1", inspectionDue: "2026-12", archivedAt: new Date() } });
    await env.db.vehicle.create({ data: { plate: "B-ZZ 5", plateNorm: "BZZ5", inspectionDue: "2031-12" } });
    const type = await env.db.appointmentType.create({ data: { name: "Reifenwechsel" } });
    const bay = await env.db.bay.create({ data: { name: "Hebebühne 7" } });
    const meister = await env.db.user.create({ data: { username: "meister", name: "Meister Eder" } });
    const mk = (title: string, startsAt: string, minutes: number, extra: Record<string, unknown> = {}) =>
      env.db.appointment.create({ data: { title, startsAt: new Date(startsAt), endsAt: new Date(new Date(startsAt).getTime() + minutes * 60_000), ...extra } });
    await mk("Räderwechsel, Winter; wichtig", "2026-11-09T08:00:00Z", 90, { notes: "INTERN: Kunde zahlt immer spät, Tel. 0170 999999", typeId: type.id, bayId: bay.id, assigneeId: meister.id, vehicleId: car.id });
    await mk("Abgesagter Termin", "2026-11-10T08:00:00Z", 60, { status: "cancelled", vehicleId: car.id });
    await mk("Termin gesperrter Kunde", "2026-11-11T08:00:00Z", 60, { customerId: restricted.id });
    await mk("Termin Fahrzeug gesperrter Halter", "2026-11-12T08:00:00Z", 60, { vehicleId: lockedCar.id });
    await mk("Zu alt", "2026-04-01T08:00:00Z", 60);
    await mk("Gerade noch drin (6 Monate zurück)", "2026-05-08T08:00:00Z", 60);
    await mk("Zu weit voraus", "2027-12-01T08:00:00Z", 60);
    await mk("Über Mitternacht", "2026-11-13T22:30:00Z", 540);
    const max = await env.db.employee.create({ data: { firstName: "Max", lastName: "Mustermann", userId: undefined } });
    const gone = await env.db.employee.create({ data: { firstName: "Ehemalig", lastName: "Weg", active: false } });
    await env.db.absence.create({ data: { employeeId: max.id, type: "sick", startDate: new Date("2026-11-16T11:00:00Z"), endDate: new Date("2026-11-18T11:00:00Z"), note: "Chemotherapie" } });
    await env.db.absence.create({ data: { employeeId: max.id, type: "vacation", startDate: new Date("2027-03-28T11:00:00Z"), endDate: new Date("2027-03-30T11:00:00Z"), note: "Skiurlaub" } });
    await env.db.absence.create({ data: { employeeId: gone.id, type: "vacation", startDate: new Date("2026-11-20T11:00:00Z"), endDate: new Date("2026-11-21T11:00:00Z") } });
    await env.db.fleetVehicle.create({ data: { plate: "B-FL 100", huDue: new Date("2027-01-15T11:00:00Z"), serviceDue: new Date("2026-12-01T11:00:00Z"), notes: "GEHEIM" } });
    await env.db.fleetVehicle.create({ data: { plate: "B-FL 200", status: "sold", huDue: new Date("2027-01-16T11:00:00Z") } });
  });

  const feedOf = async (permissions: readonly string[]) => {
    const { user } = await owner(permissions);
    const token = await plant(user.id);
    const res = await call(`${token}.ics`);
    assert.equal(res.status, 200);
    return body(res);
  };

  it("mit allen Rechten: Termine, Abwesenheiten als „abwesend“ und Fristen; Zeitraum 6 Monate zurück bis 12 Monate voraus", async () => {
    const text = await feedOf(ALL);
    const lines = summaries(text);
    assert.ok(lines.includes("Räderwechsel\\, Winter\\; wichtig · B-AB 1234 · Erika Muster"), `Titel mit Kennzeichen und Name, maskiert: ${lines}`);
    assert.ok(lines.includes("Abgesagt · Abgesagter Termin · B-AB 1234 · Erika Muster"));
    assert.ok(lines.some((l) => l.startsWith("Gerade noch drin")));
    assert.ok(lines.includes("Über Mitternacht"));
    for (const missing of ["Zu alt", "Zu weit voraus", "gesperrter Kunde", "gesperrter Halter"]) assert.ok(!lines.some((l) => l.includes(missing)), `${missing} gehört nicht in den Feed`);
    assert.ok(text.includes("DTSTART:20261109T080000Z") && text.includes("DTEND:20261109T093000Z"));
    assert.ok(text.includes("STATUS:CANCELLED"));
    assert.ok(text.includes("DTSTART:20261113T223000Z") && text.includes("DTEND:20261114T073000Z"), "über Mitternacht");
    assert.ok(lines.includes("Abwesend: Max Mustermann"));
    assert.ok(text.includes("DTSTART;VALUE=DATE:20261116") && text.includes("DTEND;VALUE=DATE:20261119"), "drei Tage, Ende exklusiv");
    assert.ok(text.includes("DTSTART;VALUE=DATE:20270328") && text.includes("DTEND;VALUE=DATE:20270331"));
    assert.ok(!lines.some((l) => l.includes("Ehemalig")), "Abwesenheit eines inaktiven Mitarbeiters nicht");
    assert.ok(lines.includes("Prüfung fällig: B-AB 1234 VW Golf"));
    assert.ok(text.includes("DTSTART;VALUE=DATE:20261231"), "Prüffrist 2026-12 = letzter Tag des Monats");
    assert.ok(lines.includes("Gasanlagenprüfung fällig: B-AB 1234 VW Golf") && text.includes("DTSTART;VALUE=DATE:20270214"));
    assert.ok(!lines.some((l) => l.includes("B-GS 9") || l.includes("B-AR 1") || l.includes("B-ZZ 5")), "gesperrter Halter, archiviert und außerhalb des Zeitraums fehlen");
    assert.ok(lines.includes("Hauptuntersuchung fällig (Fuhrpark): B-FL 100") && lines.includes("Service fällig (Fuhrpark): B-FL 100"));
    assert.ok(!lines.some((l) => l.includes("B-FL 200")), "verkaufte Fahrzeuge nicht");
    assert.ok(text.includes(`UID:appointment-`) && text.includes("@schrauberos"));
  });

  it("nichts Internes verlässt den Feed: keine Notizen, Telefonnummern, Arbeitsplatz, Zuständige, Art oder Anmerkung der Abwesenheit, Krankheit, Fahrzeugnotizen", async () => {
    const text = await feedOf(ALL);
    for (const secret of ["INTERN", "0170 999999", "0151 123456", "Hebebühne", "Meister Eder", "Chemotherapie", "Skiurlaub", "sick", "vacation", "Krankheit", "GEHEIM", "Hauptstr"]) assert.ok(!text.includes(secret), `${secret} darf nicht im Feed stehen`);
    assert.ok(!/^ATTENDEE|^ORGANIZER|^LOCATION/m.test(text));
  });

  it("der Name des Kunden nur mit `customers.view`; das Kennzeichen bleibt", async () => {
    const text = await feedOf(["appointments.view"]);
    assert.ok(summaries(text).includes("Räderwechsel\\, Winter\\; wichtig · B-AB 1234"));
    assert.ok(!text.includes("Erika") && !text.includes("Muster"));
  });

  it("fehlt ein Fachrecht, fehlt dieser Teil – der Feed bleibt gültig: nur Termine / nur Abwesenheiten / nur Fristen / gar nichts", async () => {
    const onlyAppointments = await feedOf(["appointments.view"]);
    assert.ok(events(onlyAppointments) > 0 && !summaries(onlyAppointments).some((l) => l.startsWith("Abwesend") || l.includes("fällig")));
    const onlyAbsences = await feedOf(["employees.view"]);
    assert.deepEqual(summaries(onlyAbsences).sort(), ["Abwesend: Max Mustermann", "Abwesend: Max Mustermann"]);
    const onlyVehicles = await feedOf(["vehicles.view"]);
    assert.ok(summaries(onlyVehicles).every((l) => l.includes("fällig")) && !summaries(onlyVehicles).some((l) => l.includes("Fuhrpark")));
    const onlyFleet = await feedOf(["fleet.view"]);
    assert.ok(summaries(onlyFleet).length === 2 && summaries(onlyFleet).every((l) => l.includes("Fuhrpark")));
    const none = await feedOf(["tires.view"]);
    assert.equal(events(none), 0);
    assert.ok(none.startsWith("BEGIN:VCALENDAR") && none.includes("END:VCALENDAR"));
  });

  it("wirksam sind die aktuellen Rechte bei jedem Abruf: Rolle verliert das Recht → nächster Abruf ohne diesen Teil; ausgeschaltete Funktion → fehlt", async () => {
    const { session, user } = await owner(["appointments.view", "employees.view"]);
    const token = await subscribe(session);
    assert.ok(summaries(await body(await call(`${token}.ics`))).some((l) => l.startsWith("Abwesend")));
    const role = await env.db.userRole.findFirstOrThrow({ where: { userId: user.id } });
    await env.db.rolePermission.delete({ where: { roleId_permission: { roleId: role.roleId, permission: "employees.view" } } });
    assert.ok(!summaries(await body(await call(`${token}.ics`))).some((l) => l.startsWith("Abwesend")));
    await env.db.featureSetting.upsert({ where: { key: "workshop.appointments" }, update: { enabled: false }, create: { key: "workshop.appointments", enabled: false, updatedByName: "test" } });
    try {
      assert.equal(events(await body(await call(`${token}.ics`))), 0, "Termine verschwinden, wenn die Funktion aus ist");
    } finally {
      await env.db.featureSetting.delete({ where: { key: "workshop.appointments" } });
    }
  });

  it("Besitzersprache: ein Konto mit englischer Oberfläche bekommt englische Texte im Feed", async () => {
    const { user } = await owner(["employees.view"]);
    await env.db.user.update({ where: { id: user.id }, data: { locale: "en" } });
    const token = await plant(user.id);
    assert.ok(summaries(await body(await call(`${token}.ics`))).includes("Absent: Max Mustermann"));
  });

  it("bei vorhandener Adresse der Anwendung tragen die Einträge einen Link dorthin (aus der Einstellung, nie aus der Anfrage)", async () => {
    const { session } = await owner(["appointments.view"]);
    const token = await subscribe(session);
    await env.db.appSetting.upsert({ where: { key: "app.publicUrl" }, update: { value: "https://werkstatt.example" }, create: { key: "app.publicUrl", value: "https://werkstatt.example" } });
    try {
      const text = await body(await call(`${token}.ics`, { host: "evil.example" }));
      assert.ok(/URL:https:\/\/werkstatt\.example\/appointments\?show=/.test(text));
      assert.ok(!text.includes("evil.example"));
    } finally {
      await env.db.appSetting.deleteMany({ where: { key: "app.publicUrl" } });
    }
  });

  it("Obergrenze: mehr als 5000 Einträge werden auf 5000 begrenzt (die frühesten bleiben)", async () => {
    const base = new Date("2026-12-01T06:00:00Z").getTime();
    await env.db.appointment.createMany({ data: Array.from({ length: 5003 }, (_, i) => ({ title: `Massentermin ${i}`, startsAt: new Date(base + i * 60_000), endsAt: new Date(base + i * 60_000 + 30_000) })) });
    try {
      const text = await feedOf(["appointments.view"]);
      assert.equal(events(text), feed.FEED_MAX_EVENTS);
      assert.ok(summaries(text).includes("Massentermin 0"));
    } finally {
      await env.db.appointment.deleteMany({ where: { title: { startsWith: "Massentermin" } } });
    }
    assert.ok(vehicleId);
  });
});
