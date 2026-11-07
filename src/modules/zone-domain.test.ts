import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { noon } from "@/lib/dates";
import { monthOf, monthStart } from "@/lib/month";
import { withWorkshopZone } from "@/test/zone";
import { appointmentWindow } from "./workshop/appointments/domain";
import { eventSpan, initialSlot } from "./workshop/appointments/calendar-layout";
import { workdaysBetween, workdaysWithin } from "./office/employees/domain";
import { invoiceFileLocation, paymentState } from "./office/invoices/domain";
import { nextLicenseCheck } from "./office/fleet/domain";
import { parseTireRows, wantedSeason } from "./workshop/tires/domain";
import { startOfDay } from "@/lib/zone";

/**
 * Fachlogik, die mit Tagen und Uhrzeiten rechnet, nutzt die **Zeitzone der Werkstatt** (hier Berlin, Zürich, UTC, Auckland) – der Prozess läuft in einer anderen Zone
 * (`withWorkshopZone`). Die Fälle sind die Grenzen, an denen Prozess-Ortszeit und Werkstatt-Zeit auseinanderlaufen: Mitternacht, Jahres- und Monatswechsel, Umstellungstage.
 */
const BERLIN = "Europe/Berlin";

describe("Termine: Zeitfenster und Raster", () => {
  it("appointmentWindow rechnet in der Werkstatt-Zone und lehnt die Lücke der Umstellung ab (Berlin und Zürich)", async () => {
    for (const zone of [BERLIN, "Europe/Zurich"]) {
      await withWorkshopZone(zone, () => {
        const w = appointmentWindow("2030-06-03", "09:00", 90)!;
        assert.equal(w.startsAt.toISOString(), "2030-06-03T07:00:00.000Z");
        assert.equal(w.endsAt.toISOString(), "2030-06-03T08:30:00.000Z");
        assert.equal(appointmentWindow("2030-03-31", "02:30", 60), null, zone);
        assert.ok(appointmentWindow("2030-03-31", "03:00", 60), zone);
        // am Umstellungstag zurück: 02:30 gibt es zweimal, der erste gilt
        assert.equal(appointmentWindow("2030-10-27", "02:30", 60)!.startsAt.toISOString(), "2030-10-27T00:30:00.000Z");
      });
    }
    await withWorkshopZone("UTC", () => assert.ok(appointmentWindow("2030-03-31", "02:30", 60)));
  });

  it("ein Termin über Mitternacht reicht im Raster bis 24 Uhr seines Starttags; die Minuten zählen in der Werkstatt-Zone", () =>
    withWorkshopZone(BERLIN, () => {
      const start = new Date("2030-06-03T21:30:00Z"); // 23:30 Berlin
      const end = new Date("2030-06-03T22:30:00Z"); // 00:30 am Folgetag (in UTC noch derselbe Tag!)
      assert.deepEqual(eventSpan(start, end, 15), [23 * 60 + 30, 24 * 60]);
      const sameDay = eventSpan(new Date("2030-06-03T07:00:00Z"), new Date("2030-06-03T08:30:00Z"), 15);
      assert.deepEqual(sameDay, [9 * 60, 10 * 60 + 30]);
    }));

  it("initialSlot findet den heutigen Tag nach Datum der Werkstatt, nicht der Prozess-Zone", () =>
    withWorkshopZone(BERLIN, () => {
      const now = new Date("2030-06-01T22:30:00Z"); // Berlin: Sonntag 2.6., 00:30
      const days = [startOfDay("2030-06-01"), startOfDay("2030-06-02")];
      assert.deepEqual(initialSlot({ days, now, startMin: 0, slotMinutes: 15, rows: 96 }), { col: 1, row: 2 });
    }));
});

describe("Abwesenheiten: Arbeitstage", () => {
  it("zählt Kalendertage der Werkstatt-Zone (Mo–Fr), über den Umstellungstag und das Wochenende", () =>
    withWorkshopZone(BERLIN, () => {
      // Fr 29.3. bis Mo 1.4.2030 (mit der Umstellung am Sonntag 31.3.): Freitag und Montag
      assert.equal(workdaysBetween(noon("2030-03-29"), noon("2030-04-01")), 2);
      assert.equal(workdaysBetween(noon("2030-04-01"), noon("2030-04-01")), 1);
      assert.equal(workdaysBetween(noon("2030-04-02"), noon("2030-04-01")), 0);
      // eine Woche Montag bis Sonntag
      assert.equal(workdaysBetween(noon("2030-04-01"), noon("2030-04-07")), 5);
    }));

  it("Urlaub im Jahr: nur die Tage innerhalb des Fensters, auch über den Jahreswechsel", () =>
    withWorkshopZone(BERLIN, () => {
      const absence = { startDate: noon("2029-12-27"), endDate: noon("2030-01-04") };
      assert.equal(workdaysWithin(absence, noon("2030-01-01"), noon("2030-12-31")), 4); // 1.–4.1. (Di–Fr)
      assert.equal(workdaysWithin(absence, noon("2029-01-01"), noon("2029-12-31")), 3); // 27.–31.12. (Do, Fr, Mo)
    }));
});

describe("Rechnungen und Fristen", () => {
  it("überfällig ist, was vor dem heutigen Tag der Werkstatt fällig war (Mitternacht der Werkstatt-Zone)", () =>
    withWorkshopZone(BERLIN, () => {
      const inv = { status: "open", dueDate: noon("2030-06-01") };
      // 22:30 UTC am 1.6. = 00:30 Berlin am 2.6.: der 1.6. ist vorbei
      assert.equal(paymentState(inv, new Date("2030-06-01T22:30:00Z")), "overdue");
      // 21:30 UTC am 1.6. = 23:30 Berlin am 1.6.: heute fällig, noch nicht überfällig
      assert.equal(paymentState(inv, new Date("2030-06-01T21:30:00Z")), "open");
    }));

  it("der Ablageort des Belegs trägt das Rechnungsdatum der Werkstatt (auch in Auckland, wo 12 Uhr der Vortag in UTC ist)", async () => {
    await withWorkshopZone("Pacific/Auckland", () => {
      const where = invoiceFileLocation({ direction: "incoming", issueDate: noon("2030-01-15"), number: "RE-1", partyName: "Müller" }, "application/pdf");
      assert.equal(where.dir, "rechnungen/2030/eingang");
      assert.match(where.name, /^2030-01-15_/);
    }, "UTC");
    await withWorkshopZone(BERLIN, () => {
      const where = invoiceFileLocation({ direction: "outgoing", issueDate: noon("2031-01-01"), number: "A-1", partyName: "X" }, "application/pdf");
      assert.equal(where.dir, "rechnungen/2031/ausgang");
    });
  });

  it("die nächste Führerscheinkontrolle liegt sechs Monate später am selben Kalendertag (Mittag bleibt Mittag über die Sommerzeit)", () =>
    withWorkshopZone(BERLIN, () => {
      const next = nextLicenseCheck(noon("2030-01-31"));
      assert.equal(next.toISOString(), "2030-07-31T10:00:00.000Z"); // 31.7. 12 Uhr MESZ
    }));
});

describe("Reifen: Saison und Reifenalter", () => {
  it("die Saison richtet sich nach dem Monat in der Zone der Werkstatt (Monatswechsel um Mitternacht)", async () => {
    const lastMomentOfMarch = new Date("2030-03-31T21:30:00Z"); // 23:30 Berlin, noch März
    const firstMomentOfApril = new Date("2030-03-31T22:30:00Z"); // 00:30 Berlin, schon April
    await withWorkshopZone(BERLIN, () => {
      assert.equal(wantedSeason(lastMomentOfMarch), "winter");
      assert.equal(wantedSeason(firstMomentOfApril), "summer");
    });
    await withWorkshopZone("UTC", () => assert.equal(wantedSeason(firstMomentOfApril), "winter"));
  });

  it("die DOT-Prüfung nimmt das Jahr der Werkstatt (Silvester)", () =>
    withWorkshopZone(BERLIN, () => {
      const row = { FL: { dot: "0131" } };
      const newYear = new Date("2030-12-31T23:30:00Z"); // Berlin: schon 2031
      assert.deepEqual(parseTireRows(row, false, newYear).errors, {});
      assert.ok(parseTireRows(row, false, new Date("2030-12-31T12:00:00Z")).errors["tire.FL.dot"]);
    }));
});

describe("Monate (Prüffristen)", () => {
  it("monthOf und monthStart folgen der Werkstatt-Zone", () =>
    withWorkshopZone(BERLIN, () => {
      assert.equal(monthOf(new Date("2030-03-31T23:30:00Z")), "2030-04");
      assert.equal(monthOf(new Date("2030-03-31T23:30:00Z"), "UTC"), "2030-03");
      assert.equal(monthStart("2030-04").toISOString(), "2030-04-01T10:00:00.000Z");
    }));
});
