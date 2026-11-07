import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { apiRequest, makeToken } from "@/test/api-helpers";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Berichte (F9) gegen eine echte temporäre SQLite, mit **handgerechneten** Fällen: Umsatz je Monat (Storno negativ, Abschlag und Schlussrechnung, Angebote/Entwürfe/Auftragsbestätigungen nie, von Hand
 * als storniert markierte Rechnung nie, Eingangsrechnungen nie, Monatsgrenze in der Werkstatt-Zone), offene Posten (Stufen, Art. 18), Auslastung (Öffnungszeit, abgesagte Termine, Feiertag), Einlagerungsbestand,
 * Fälligkeiten; Rechte je Quelle, CSV-Export (Recht, Audit, Formelschutz) und API.
 */
let env: TestEnv;
let queries: typeof import("./queries");
let access: typeof import("./access");
let ids: { restricted: string; holder: string; erika: string; carRestricted: string; carFree: string };

const noon = async (day: string, zone?: string) => (await import("@/lib/zone")).noon(day, zone);

async function session(permissions: readonly string[]) {
  const role = await env.role({ permissions });
  env.signOut();
  await env.signIn(await env.user({ username: `r-${Math.random().toString(36).slice(2)}`, roles: [role] }));
  return (await (await import("@/server/auth/session")).getSession())!;
}

/** Alle Rechnungen entfernen, in der Reihenfolge der Verknüpfungen (Anrechnungen und Gegenbelege hängen mit Restrict an den anderen). */
async function clearInvoices() {
  await env.db.invoiceDeduction.deleteMany();
  await env.db.invoice.deleteMany({ where: { cancelsInvoiceId: { not: null } } });
  await env.db.invoice.deleteMany();
}

let invoiceCounter = 0;
async function invoice(data: Record<string, unknown>) {
  invoiceCounter += 1;
  return env.db.invoice.create({ data: { direction: "outgoing", number: `T-${invoiceCounter}`, partyName: "Muster GmbH", issueDate: await noon("2026-03-15"), grossCents: 0, ...data } as never });
}

before(async () => {
  env = await createTestEnv();
  queries = await import("./queries");
  access = await import("./access");
  const erika = await env.db.customer.create({ data: { firstName: "Erika", lastName: "Muster", nameKey: "erika muster" } });
  const restricted = await env.db.customer.create({ data: { lastName: "Gesperrt", processingRestrictedAt: new Date(), nameKey: "gesperrt" } });
  const carFree = await env.db.vehicle.create({ data: { plate: "B-AB 1", plateNorm: "BAB1", make: "VW", model: "Golf", customerId: erika.id, inspectionDue: "2026-11" } });
  const carRestricted = await env.db.vehicle.create({ data: { plate: "B-GS 9", plateNorm: "BGS9", customerId: restricted.id, inspectionDue: "2026-11" } });
  ids = { restricted: restricted.id, holder: restricted.id, erika: erika.id, carRestricted: carRestricted.id, carFree: carFree.id };
});
after(() => env.cleanup());

describe("Rechte je Bericht (access.ts)", () => {
  it("jeder Bericht braucht reports.view und das Leserecht der Quelle; die Fälligkeiten eine von drei Quellen", () => {
    const can = (...permissions: string[]) => ({ can: (p: string) => permissions.includes(p) }) as never;
    assert.deepEqual(access.openableReports(can("reports.view")), [], "ohne Quelle gibt es keinen");
    assert.deepEqual(access.openableReports(can("invoices.view")), [], "ohne reports.view auch nicht");
    assert.deepEqual(access.openableReports(can("reports.view", "invoices.view")), ["revenue", "openItems", "due"]);
    assert.deepEqual(access.openableReports(can("reports.view", "appointments.view")), ["utilization"]);
    assert.deepEqual(access.openableReports(can("reports.view", "tires.view")), ["storage"]);
    assert.deepEqual(access.openableReports(can("reports.view", "fleet.view")), ["due"]);
    assert.deepEqual(access.openableReports(can("reports.view", "invoices.view", "appointments.view", "tires.view", "vehicles.view")), ["revenue", "openItems", "utilization", "storage", "due"]);
  });
});

describe("Umsatz je Monat", () => {
  before(async () => {
    const d = async (day: string) => noon(day);
    const base = { source: "billing", finalizedAt: new Date("2026-06-01T10:00:00Z") };
    // März: festgeschriebene Rechnung (billing), von Hand erfasste Rechnung, von Hand erfasste ohne Netto/Steuer
    const manual = await invoice({ number: "M-1", issueDate: await d("2026-03-15"), netCents: 10_000, vatCents: 1_900, grossCents: 11_900 });
    await invoice({ number: "B-1", issueDate: await d("2026-03-31"), netCents: 20_000, vatCents: 3_800, grossCents: 23_800, ...base });
    await invoice({ number: "M-2", issueDate: await d("2026-03-20"), grossCents: 5_000 });
    // gehört nie zum Umsatz: Entwurf, Angebot, Auftragsbestätigung, Eingangsrechnung, von Hand als storniert markiert (ohne Gegenbeleg)
    await invoice({ number: "", issueDate: await d("2026-03-10"), netCents: 50_000, vatCents: 9_500, grossCents: 59_500, source: "billing", finalizedAt: null });
    await invoice({ number: "O-1", issueDate: await d("2026-03-10"), grossCents: 77_700, source: "billing", docType: "offer", finalizedAt: new Date("2026-06-01T10:00:00Z") });
    await invoice({ number: "AB-1", issueDate: await d("2026-03-10"), grossCents: 88_800, source: "billing", docType: "confirmation", finalizedAt: new Date("2026-06-01T10:00:00Z") });
    await invoice({ number: "E-1", direction: "incoming", issueDate: await d("2026-03-10"), grossCents: 99_900 });
    await invoice({ number: "V-1", issueDate: await d("2026-03-12"), grossCents: 9_999, status: "cancelled" });
    // April: Rechnung am 1.4., Abschlag am 10.4., Gegenbeleg zur Rechnung M-1 am 5.4. (negativ)
    await invoice({ number: "B-2", issueDate: await d("2026-04-01"), netCents: 1_000, vatCents: 190, grossCents: 1_190, ...base });
    const partial = await invoice({ number: "A-1", issueDate: await d("2026-04-10"), netCents: 10_000, vatCents: 1_900, grossCents: 11_900, docType: "partial", ...base });
    await invoice({ number: "G-1", issueDate: await d("2026-04-05"), netCents: -10_000, vatCents: -1_900, grossCents: -11_900, docType: "credit", status: "cancelled", cancelsInvoiceId: manual.id, finalizedAt: new Date("2026-06-01T10:00:00Z") });
    await env.db.invoice.update({ where: { id: manual.id }, data: { status: "cancelled" } });
    // Mai: Schlussrechnung rechnet den Abschlag an (brutto 11.900)
    const final = await invoice({ number: "S-1", issueDate: await d("2026-05-20"), netCents: 40_000, vatCents: 7_600, grossCents: 47_600, deductedCents: 11_900, docType: "final", ...base });
    await env.db.invoiceDeduction.create({ data: { finalId: final.id, partialId: partial.id, finalKey: partial.id } });
  });

  it("März bis Mai von Hand gerechnet: Brutto, Netto, Steuer, Belege; Storno im Monat des Gegenbelegs; Schlussrechnung abzüglich Abschlag", async () => {
    const report = await queries.revenueReport(await session(["invoices.view"]), { from: "2026-03-10", to: "2026-05-20" });
    assert.ok(report);
    assert.equal(report.from, "2026-03-01");
    assert.equal(report.to, "2026-05-31");
    const [mar, apr, may] = report.months;
    // März: M-1 (11.900/10.000/1.900) + B-1 (23.800/20.000/3.800) + M-2 (5.000, ohne Netto) = 40.700 brutto, 30.000 netto, 5.700 Steuer, 3 Belege
    assert.deepEqual(mar, { month: "2026-03", count: 3, netCents: 30_000, vatCents: 5_700, grossCents: 40_700, withoutNet: 1 });
    // April: B-2 (1.190/1.000/190) + Abschlag A-1 (11.900/10.000/1.900) + Gegenbeleg G-1 (−11.900/−10.000/−1.900) = 1.190 / 1.000 / 190, 3 Belege
    assert.deepEqual(apr, { month: "2026-04", count: 3, netCents: 1_000, vatCents: 190, grossCents: 1_190, withoutNet: 0 });
    // Mai: Schlussrechnung 47.600 − angerechneter Abschlag 11.900 = 35.700 brutto; netto 40.000 − 10.000 = 30.000; Steuer 7.600 − 1.900 = 5.700
    assert.deepEqual(may, { month: "2026-05", count: 1, netCents: 30_000, vatCents: 5_700, grossCents: 35_700, withoutNet: 0 });
    assert.deepEqual(report.total, { count: 7, netCents: 61_000, vatCents: 11_590, grossCents: 77_590, withoutNet: 1 });
  });

  it("Angebote, Auftragsbestätigungen, Entwürfe, Eingangsrechnungen und von Hand als storniert markierte Rechnungen zählen nie – auch nicht in einem Monat nur mit ihnen", async () => {
    const report = await queries.revenueReport(await session(["invoices.view"]), { from: "2026-03-01", to: "2026-03-31" });
    assert.equal(report!.months[0].count, 3, "weder 59.500 noch 77.700, 88.800, 99.900 oder 9.999");
    assert.equal(report!.total.grossCents, 40_700);
  });

  it("ein Monat ohne Belege ist eine Zeile mit Nullen; ein Jahr ohne Umsatz ebenso", async () => {
    const report = await queries.revenueReport(await session(["invoices.view"]), { from: "2026-07-01", to: "2026-08-31" });
    assert.deepEqual(report!.months.map((m) => [m.month, m.count, m.grossCents]), [["2026-07", 0, 0], ["2026-08", 0, 0]]);
  });

  it("die Monatsgrenze gilt in der Zone der Werkstatt: Rechnungsdatum 1. April in Neuseeland (12 Uhr Ortszeit = 31. März 23 Uhr UTC) zählt im April, nicht im März", async () => {
    await env.db.workshop.upsert({ where: { id: "default" }, update: { timezone: "Pacific/Auckland" }, create: { id: "default", timezone: "Pacific/Auckland" } });
    try {
      const { setWorkshopZone } = await import("@/lib/zone");
      setWorkshopZone("Pacific/Auckland");
      const a = await invoice({ number: "NZ-1", issueDate: await noon("2025-04-01", "Pacific/Auckland"), grossCents: 1_000 });
      const b = await invoice({ number: "NZ-2", issueDate: await noon("2025-03-31", "Pacific/Auckland"), grossCents: 2_000 });
      assert.equal(a.issueDate.toISOString(), "2025-03-31T23:00:00.000Z");
      const report = await queries.revenueReport(await session(["invoices.view"]), { from: "2025-03-01", to: "2025-04-30" });
      const byMonth = Object.fromEntries(report!.months.map((m) => [m.month, m.grossCents]));
      assert.deepEqual(byMonth, { "2025-03": 2_000, "2025-04": 1_000 });
      await env.db.invoice.deleteMany({ where: { id: { in: [a.id, b.id] } } });
    } finally {
      await env.db.workshop.update({ where: { id: "default" }, data: { timezone: "Europe/Berlin" } });
      (await import("@/lib/zone")).setWorkshopZone("Europe/Berlin");
    }
  });

  it("ohne invoices.view gibt es keinen Umsatz (null)", async () => {
    assert.equal(await queries.revenueReport(await session(["reports.view"]), { from: "2026-03-01", to: "2026-03-31" }), null);
  });
});

describe("Offene Posten", () => {
  const today = "2026-11-07";
  before(async () => {
    await clearInvoices();
    const open = (number: string, due: string | null, gross: number, extra: Record<string, unknown> = {}) => invoice({ number, grossCents: gross, status: "open", dueDate: null, ...extra }).then(async (row) => (due ? env.db.invoice.update({ where: { id: row.id }, data: { dueDate: await noon(due) } }) : row));
    await open("O-1", "2026-11-20", 10_000);
    await open("O-2", null, 5_000);
    await open("O-3", "2026-11-06", 20_000, { paidCents: 5_000 });
    await open("O-4", "2026-09-30", 30_000, { deductedCents: 10_000, docType: "final", source: "billing", finalizedAt: new Date("2026-06-01T10:00:00Z") });
    await open("O-5", "2026-08-01", 40_000);
    await open("O-6", "2026-10-01", 7_000, { customerId: ids.restricted });
    // nie offen: bezahlt, Angebot, Entwurf, Gegenbeleg; Eingangsrechnung nur in der anderen Richtung
    await open("P-1", "2026-10-01", 111_000, { status: "paid" });
    await open("P-2", "2026-10-01", 222_000, { docType: "offer", source: "billing", finalizedAt: new Date("2026-06-01T10:00:00Z") });
    await open("P-3", "2026-10-01", 333_000, { source: "billing", finalizedAt: null });
    await open("P-4", "2026-10-01", -444_000, { docType: "credit" });
    await open("I-1", "2026-10-10", 3_000, { direction: "incoming" });
  });

  it("Stufen von Hand gerechnet: nicht fällig 15.000, 1–30 Tage 15.000, 31–60 Tage 27.000 (inkl. gesperrtem Kunden), über 90 Tage 40.000; Summe 97.000", async () => {
    const report = await queries.openItemsReport(await session(["invoices.view"]), { direction: "outgoing", today });
    assert.ok(report);
    const byBucket = Object.fromEntries(report.buckets.map((b) => [b.bucket, [b.count, b.cents]]));
    assert.deepEqual(byBucket, { notDue: [2, 15_000], d1_30: [1, 15_000], d31_60: [2, 27_000], d61_90: [0, 0], d91plus: [1, 40_000] });
    assert.deepEqual(report.total, { count: 6, cents: 97_000 });
  });

  it("die Liste: die ältesten zuerst, ohne Fälligkeit zuletzt, mit Alter in Tagen; Kunden mit eingeschränkter Verarbeitung stehen nur in den Summen (Anzahl als Hinweis)", async () => {
    const report = await queries.openItemsReport(await session(["invoices.view"]), { direction: "outgoing", today });
    assert.deepEqual(report!.items.map((i) => [i.number, i.daysOverdue, i.outstandingCents]), [["O-5", 98, 40_000], ["O-4", 38, 20_000], ["O-3", 1, 15_000], ["O-1", 0, 10_000], ["O-2", 0, 5_000]]);
    assert.ok(!JSON.stringify(report!.items).includes("Gesperrt") && !report!.items.some((i) => i.number === "O-6"));
    assert.equal(report!.hiddenCount, 1);
  });

  it("Verbindlichkeiten (Eingangsrechnungen) getrennt; ohne Recht null", async () => {
    const incoming = await queries.openItemsReport(await session(["invoices.view"]), { direction: "incoming", today });
    assert.deepEqual(incoming!.total, { count: 1, cents: 3_000 });
    assert.equal(incoming!.buckets.find((b) => b.bucket === "d1_30")!.count, 1, "10.10. ist 28 Tage überfällig");
    assert.equal(await queries.openItemsReport(await session(["reports.view"]), { direction: "outgoing", today }), null);
  });
});

describe("Auslastung", () => {
  let bayA: string;
  let bayB: string;
  before(async () => {
    bayA = (await env.db.bay.create({ data: { name: "Hebebühne 1", sortOrder: 1 } })).id;
    bayB = (await env.db.bay.create({ data: { name: "Hebebühne 2", sortOrder: 2 } })).id;
    await env.db.bay.create({ data: { name: "Archiviert ohne Termine", active: false, sortOrder: 3 } });
    const inactiveUsed = (await env.db.bay.create({ data: { name: "Archiviert mit Terminen", active: false, sortOrder: 4 } })).id;
    const mk = (bayId: string | null, start: string, end: string, status = "scheduled") => env.db.appointment.create({ data: { title: "T", startsAt: new Date(start), endsAt: new Date(end), bayId, status } });
    // Woche Mo 2.11. bis So 8.11.2026 (MEZ = UTC+1)
    await mk(bayA, "2026-11-02T08:00:00Z", "2026-11-02T09:30:00Z"); // Mo 09:00–10:30: 90
    await mk(bayA, "2026-11-03T05:30:00Z", "2026-11-03T07:30:00Z"); // Di 06:30–08:30: 60 innerhalb
    await mk(bayA, "2026-11-04T08:00:00Z", "2026-11-04T09:00:00Z", "cancelled"); // abgesagt
    await mk(bayA, "2026-11-04T10:00:00Z", "2026-11-04T11:00:00Z", "no_show"); // nicht erschienen
    await mk(bayA, "2026-11-07T08:00:00Z", "2026-11-07T11:00:00Z"); // Sa: geschlossen
    await mk(bayB, "2026-11-04T07:00:00Z", "2026-11-04T16:00:00Z"); // Mi 08:00–17:00: 540
    await mk(null, "2026-11-05T09:00:00Z", "2026-11-05T10:00:00Z"); // ohne Arbeitsplatz: 60
    await mk(inactiveUsed, "2026-11-06T09:00:00Z", "2026-11-06T10:00:00Z"); // Fr 10:00–11:00: 60
    await mk(bayB, "2026-12-01T08:00:00Z", "2026-12-01T09:00:00Z"); // außerhalb des Zeitraums
  });

  it("Öffnungszeit 46,5 Stunden (Mo–Do 9,5, Fr 8,5); gebucht nur innerhalb; abgesagt/nicht erschienen/Samstag zählen nicht; Prozent mit einer Nachkommastelle", async () => {
    const report = await queries.utilizationReport(await session(["appointments.view"]), { from: "2026-11-02", to: "2026-11-08" });
    assert.ok(report);
    assert.equal(report.capacityMinutes, 2_790);
    const row = (name: string | null) => report.rows.find((r) => r.name === name)!;
    assert.equal(row("Hebebühne 1").appointments, 3, "Montag, Dienstag und Samstag; abgesagt und nicht erschienen belegen keinen Platz");
    assert.equal(row("Hebebühne 1").bookedMinutes, 150, "90 + 60");
    assert.equal(row("Hebebühne 1").utilization, 5.4, "150 / 2790");
    assert.equal(row("Hebebühne 2").bookedMinutes, 540);
    assert.equal(row("Hebebühne 2").utilization, 19.4, "540 / 2790 = 19,35 %");
    assert.equal(row("Archiviert mit Terminen").bookedMinutes, 60);
    assert.equal(row("Archiviert mit Terminen").active, false);
    assert.ok(!report.rows.some((r) => r.name === "Archiviert ohne Termine"), "archiviert und ohne Termine fehlt");
    const none = report.rows.find((r) => r.id === null)!;
    assert.deepEqual([none.appointments, none.bookedMinutes, none.utilization], [1, 60, null], "ohne Arbeitsplatz: keine Prozent");
    assert.equal(report.truncated, false);
  });

  it("ein Feiertag ohne Öffnung nimmt die Kapazität weg und die Termine darauf zählen nicht", async () => {
    await env.db.holidayDay.create({ data: { kind: "custom", name: "Betriebsruhe", month: 11, day: 4, year: 2026, half: false } as never });
    try {
      const report = await queries.utilizationReport(await session(["appointments.view"]), { from: "2026-11-02", to: "2026-11-08" });
      assert.equal(report!.capacityMinutes, 2_790 - 570);
      assert.equal(report!.rows.find((r) => r.name === "Hebebühne 2")!.bookedMinutes, 0, "Mittwoch ist frei");
    } finally {
      await env.db.holidayDay.deleteMany();
    }
  });

  it("ohne Öffnungszeit im Zeitraum (nur Wochenende) keine Auslastung; ohne appointments.view null", async () => {
    const weekend = await queries.utilizationReport(await session(["appointments.view"]), { from: "2026-11-07", to: "2026-11-08" });
    assert.equal(weekend!.capacityMinutes, 0);
    assert.ok(weekend!.rows.every((r) => r.utilization === null));
    assert.equal(await queries.utilizationReport(await session(["reports.view"]), { from: "2026-11-02", to: "2026-11-08" }), null);
    assert.ok(bayA && bayB);
  });

  it("der Bericht enthält nichts als Arbeitsplatz, Zeiten und Anzahlen: keine Titel, Kunden oder Fahrzeuge", async () => {
    const report = await queries.utilizationReport(await session(["appointments.view"]), { from: "2026-11-02", to: "2026-11-08" });
    assert.deepEqual(Object.keys(report!.rows[0]).sort(), ["active", "appointments", "bookedMinutes", "id", "name", "utilization"]);
  });
});

describe("Einlagerungsbestand", () => {
  before(async () => {
    const mk = (data: Record<string, unknown>) => env.db.tireSet.create({ data: { vehicleId: ids.carFree, ...data } as never });
    await mk({ season: "winter", storageLocation: "Halle A / Regal 1", storedAt: new Date("2025-10-20T10:00:00Z") });
    await mk({ season: "winter", storageLocation: "Halle A / Regal 1", storedAt: new Date("2024-11-02T10:00:00Z") });
    await mk({ season: "summer", storageLocation: "Halle A / Regal 1", storedAt: new Date("2026-04-02T10:00:00Z") });
    await mk({ season: "allseason", storageLocation: "Halle A / Regal 10", storedAt: new Date("2026-01-05T10:00:00Z") });
    await mk({ season: "allseason", storageLocation: "Halle A / Regal 2", storedAt: new Date("2026-01-06T10:00:00Z") });
    await mk({ season: "winter", storageLocation: null, storedAt: new Date("2026-02-01T10:00:00Z") });
    await env.db.tireSet.create({ data: { vehicleId: ids.carRestricted, season: "summer", storageLocation: "Halle A / Regal 2", storedAt: new Date("2026-03-01T10:00:00Z") } });
    await mk({ season: "summer", storageLocation: "Halle B", status: "mounted" });
    await mk({ season: "winter", storageLocation: "Halle B", status: "disposed" });
  });

  it("nur eingelagerte Sätze, je Lagerplatz und Saison (natürliche Sortierung, ohne Lagerplatz zuletzt) mit der ältesten Einlagerung", async () => {
    const report = await queries.storageReport(await session(["tires.view"]));
    assert.ok(report);
    assert.deepEqual(report.bySeason, { summer: 2, winter: 3, allseason: 2 });
    assert.equal(report.total, 7);
    assert.deepEqual(
      report.rows.map((r) => [r.location, r.summer, r.winter, r.allseason, r.total, r.oldestDay]),
      [
        ["Halle A / Regal 1", 1, 2, 0, 3, "2024-11-02"],
        ["Halle A / Regal 2", 1, 0, 1, 2, "2026-01-06"],
        ["Halle A / Regal 10", 0, 0, 1, 1, "2026-01-05"],
        [null, 0, 1, 0, 1, "2026-02-01"],
      ],
    );
  });

  it("keine Namen und Kennzeichen im Ergebnis; auch Sätze eines Kunden mit eingeschränkter Verarbeitung zählen als Zahl; ohne tires.view null", async () => {
    const json = JSON.stringify(await queries.storageReport(await session(["tires.view"])));
    for (const secret of ["B-AB 1", "B-GS 9", "Muster", "Gesperrt", "plate", "vehicle"]) assert.ok(!json.includes(secret), secret);
    assert.equal(await queries.storageReport(await session(["reports.view"])), null);
  });
});

describe("Fälligkeiten", () => {
  const today = "2026-11-07";
  before(async () => {
    await env.db.vehicle.deleteMany();
    const erika = ids.erika;
    const mk = (plate: string, due: string | null, extra: Record<string, unknown> = {}) => env.db.vehicle.create({ data: { plate, plateNorm: plate.replace(/\W/g, ""), make: "VW", model: "Golf", inspectionDue: due, ...extra } as never });
    await mk("B-V 1", "2026-09", { customerId: erika }); // überfällig
    await mk("B-V 2", "2026-11");
    await mk("B-V 3", "2026-12");
    await mk("B-V 4", "2027-01");
    await mk("B-V 5", "2027-02"); // außerhalb der Vorschau
    await mk("B-V 6", "2026-11", { archivedAt: new Date() });
    await mk("B-V 7", "2026-11", { customerId: ids.restricted });
    await env.db.fleetVehicle.deleteMany();
    await env.db.fleetVehicle.create({ data: { plate: "F-1", huDue: await noon("2026-12-15") } });
    await env.db.fleetVehicle.create({ data: { plate: "F-2", serviceDue: await noon("2026-10-20") } });
    await env.db.fleetVehicle.create({ data: { plate: "F-3", status: "sold", huDue: await noon("2026-12-01") } });
    await env.db.fleetVehicle.create({ data: { plate: "F-4", huDue: await noon("2027-03-01") } });
    await clearInvoices();
    const due = async (number: string, direction: string, day: string, gross: number, extra: Record<string, unknown> = {}) => (await invoice({ number, direction, grossCents: gross, status: "open", ...extra }).then(async (r) => env.db.invoice.update({ where: { id: r.id }, data: { dueDate: await noon(day) } })));
    await due("Z-1", "outgoing", "2026-12-01", 10_000);
    await due("Z-2", "outgoing", "2026-11-01", 99_000); // schon überfällig: nicht hier
    await due("Z-3", "incoming", "2026-11-15", 3_000);
    await due("Z-4", "outgoing", "2027-02-01", 5_000); // nach der Vorschau
  });

  it("Prüffristen: überfällig und je Monat gezählt, archivierte und Fahrzeuge eines Kunden mit eingeschränkter Verarbeitung fehlen (Zahlen und Liste), kein Halter im Ergebnis", async () => {
    const report = await queries.dueReport(await session(["vehicles.view"]), { today, months: 3 });
    assert.equal(report.untilMonth, "2027-01");
    assert.equal(report.inspection!.overdue, 1);
    assert.deepEqual(report.inspection!.months, [{ month: "2026-11", count: 1 }, { month: "2026-12", count: 1 }, { month: "2027-01", count: 1 }]);
    assert.deepEqual(report.inspection!.items.map((i) => [i.plate, i.month]), [["B-V 1", "2026-09"], ["B-V 2", "2026-11"], ["B-V 3", "2026-12"], ["B-V 4", "2027-01"]]);
    const json = JSON.stringify(report);
    for (const secret of ["Erika", "Muster", "Gesperrt", "customer", "B-V 6", "B-V 7"]) assert.ok(!json.includes(secret), secret);
  });

  it("jeder Teil nur mit dem Recht seiner Quelle (sonst null): nur Fahrzeuge / nur Fuhrpark / nur Rechnungen", async () => {
    const vehicles = await queries.dueReport(await session(["vehicles.view"]), { today, months: 3 });
    assert.ok(vehicles.inspection && vehicles.fleet === null && vehicles.payments === null);
    const fleet = await queries.dueReport(await session(["fleet.view"]), { today, months: 3 });
    assert.ok(fleet.inspection === null && fleet.payments === null);
    assert.deepEqual(fleet.fleet!.map((f) => [f.plate, f.kind, f.day]), [["F-2", "service", "2026-10-20"], ["F-1", "hu", "2026-12-15"]], "auch ein noch offener Termin der letzten Monate; verkauft und später nicht");
    const invoices = await queries.dueReport(await session(["invoices.view"]), { today, months: 3 });
    assert.ok(invoices.inspection === null && invoices.fleet === null);
    assert.deepEqual([invoices.payments!.outgoing.count, invoices.payments!.outgoing.cents, invoices.payments!.incoming.count, invoices.payments!.incoming.cents], [1, 10_000, 1, 3_000], "Z-1 und Z-3; Z-2 ist überfällig, Z-4 später");
    const none = await queries.dueReport(await session(["reports.view"]), { today, months: 3 });
    assert.ok(none.inspection === null && none.fleet === null && none.payments === null);
  });

  it("die Vorschau: ein Monat zählt nur den laufenden", async () => {
    const report = await queries.dueReport(await session(["vehicles.view"]), { today, months: 1 });
    assert.deepEqual(report.inspection!.months, [{ month: "2026-11", count: 1 }]);
  });
});

describe("CSV-Export (Datenaustausch)", () => {
  const headers = { "x-requested-with": "schrauberos", host: "localhost" };
  const call = async (kind: string, query = "") => (await import("@/app/api/exchange/[kind]/route")).GET(new NextRequest(`http://localhost/api/exchange/${kind}${query}`, { headers }), { params: Promise.resolve({ kind }) });
  const features = ["office.reports"];

  before(async () => {
    for (const key of features) await env.db.featureSetting.upsert({ where: { key }, update: { enabled: true }, create: { key, enabled: true, updatedByName: "test" } });
    await clearInvoices();
    await invoice({ number: "X-1", issueDate: await noon("2026-03-15"), netCents: 10_000, vatCents: 1_900, grossCents: 11_900 });
    await env.db.bay.create({ data: { name: "=HYPERLINK(\"http://evil.example\",\"x\")", sortOrder: 9 } });
    await env.db.appointment.create({ data: { title: "T", startsAt: new Date("2026-11-02T08:00:00Z"), endsAt: new Date("2026-11-02T09:00:00Z"), bayId: (await env.db.bay.findFirstOrThrow({ where: { name: { startsWith: "=" } } })).id } });
  });

  it("Recht reports.export plus reports.view plus Quelle: ohne eines 403; mit allen 200 und die Zahlen der Tabelle; Audit mit Anzahl", async () => {
    await session(["reports.view", "invoices.view"]);
    assert.equal((await call("report-revenue", "?from=2026-03-01&to=2026-03-31")).status, 403, "ohne reports.export");
    await session(["reports.export", "invoices.view"]);
    assert.equal((await call("report-revenue", "?from=2026-03-01&to=2026-03-31")).status, 403, "ohne reports.view");
    await session(["reports.export", "reports.view"]);
    assert.equal((await call("report-revenue", "?from=2026-03-01&to=2026-03-31")).status, 403, "ohne Quellrecht");
    await env.db.auditLog.deleteMany();
    await session(["reports.export", "reports.view", "invoices.view"]);
    const res = await call("report-revenue", "?from=2026-03-01&to=2026-03-31&format=international");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /^text\/csv/);
    assert.match(res.headers.get("content-disposition") ?? "", /bericht-umsatz-2026-03-01_2026-03-31\.csv/);
    const text = (await res.text()).replace(new RegExp("^" + String.fromCharCode(0xfeff)), "");
    const lines = text.trim().split("\r\n");
    assert.equal(lines[0], "Monat,Belege,Netto,Steuer,Brutto,Belege ohne Netto-/Steuerangabe");
    assert.equal(lines[1], "2026-03,1,100.00,19.00,119.00,0");
    assert.equal(lines[2], ",1,100.00,19.00,119.00,0", "Summenzeile");
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "reports.export" } });
    assert.match(entry.target ?? "", /^2 Zeilen · Umsatz 2026-03-01\.\.2026-03-31$/);
  });

  it("ein ungültiger Zeitraum ist 422; die Fälligkeiten verlangen nur reports.view und eine Quelle", async () => {
    await session(["reports.export", "reports.view", "invoices.view"]);
    assert.equal((await call("report-revenue", "?from=2026-03-31&to=2026-03-01")).status, 422);
    assert.equal((await call("report-due", "?months=3")).status, 200);
    await session(["reports.export", "reports.view"]);
    assert.equal((await call("report-due", "?months=3")).status, 422, "ohne jede Quelle");
  });

  it("Texte aus der Datenbank (Arbeitsplatzname) laufen durch den Formelschutz; berechnete Zahlen nicht", async () => {
    await session(["reports.export", "reports.view", "appointments.view"]);
    const res = await call("report-utilization", "?from=2026-11-02&to=2026-11-08&format=international");
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes("'=HYPERLINK"), `Formel entschärft: ${text}`);
    assert.ok(!/^=HYPERLINK/m.test(text));
  });
});

describe("API (lesend)", () => {
  let router: typeof import("@/server/api/router");
  let state: typeof import("@/server/api/state");
  before(async () => {
    router = await import("@/server/api/router");
    state = await import("@/server/api/state");
    state.apiLimits.failuresGlobal = 1_000_000;
    await env.db.featureSetting.upsert({ where: { key: "office.reports" }, update: { enabled: true }, create: { key: "office.reports", enabled: true, updatedByName: "test" } });
  });
  const get = async (token: string, path: string) => {
    const res = await router.handleApiRequest(apiRequest("GET", path, { token }));
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  };

  it("verlangt reports.view am Token und das Leserecht der Quelle – beides bei Scope und Besitzer", async () => {
    const full = await makeToken(env, { ownerPermissions: ["reports.view", "invoices.view"], scope: ["reports.view", "invoices.view"] });
    assert.equal((await get(full.token, "/reports/revenue?from=2026-03-01&to=2026-03-31")).status, 200);
    const noSource = await makeToken(env, { ownerPermissions: ["reports.view", "invoices.view"], scope: ["reports.view"] });
    assert.equal((await get(noSource.token, "/reports/revenue")).status, 403, "Quelle fehlt im Scope");
    const noReports = await makeToken(env, { ownerPermissions: ["reports.view", "invoices.view"], scope: ["invoices.view"] });
    assert.equal((await get(noReports.token, "/reports/revenue")).status, 403, "reports.view fehlt im Scope");
    const ownerLacks = await makeToken(env, { ownerPermissions: ["reports.view"], scope: ["reports.view", "invoices.view"] });
    assert.equal((await get(ownerLacks.token, "/reports/revenue")).status, 403, "der Besitzer hat die Quelle nicht");
    assert.equal((await get(ownerLacks.token, "/reports/storage")).status, 403);
  });

  it("liefert die Zahlen des Berichts als Cent; ungültiger Zeitraum 422; Fälligkeiten mit null für fehlende Teile", async () => {
    const t = await makeToken(env, { ownerPermissions: ["reports.view", "invoices.view", "vehicles.view"], scope: ["reports.view", "invoices.view", "vehicles.view"] });
    const revenue = await get(t.token, "/reports/revenue?from=2026-03-01&to=2026-03-31");
    assert.deepEqual(revenue.json.data.total, { count: 1, netCents: 10_000, vatCents: 1_900, grossCents: 11_900, withoutNet: 0 });
    assert.equal((await get(t.token, "/reports/revenue?from=2026-03-31&to=2026-03-01")).status, 422);
    assert.equal((await get(t.token, "/reports/revenue?from=2026-02-30&to=2026-03-01")).status, 422);
    const due = await get(t.token, "/reports/due?months=3");
    assert.equal(due.status, 200);
    assert.equal(due.json.data.fleet, null);
    assert.ok(due.json.data.inspection && due.json.data.payments);
    assert.equal((await get(t.token, "/reports/due?months=2")).status, 422);
  });

  it("reports.export kann kein Token tragen (Export gibt es nur mit Sitzung)", async () => {
    const { grantablePermissions } = await import("@/lib/api/scope");
    assert.ok(!grantablePermissions().includes("reports.export"));
    assert.ok(grantablePermissions().includes("reports.view"));
  });
});
