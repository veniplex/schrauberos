import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { NO_HOLIDAYS, createHolidayCalendar } from "@/lib/holidays";
import { DEFAULT_OPENING_HOURS, type OpeningHours } from "@/lib/opening-hours";
import { resetWorkshopZone, setWorkshopZone } from "@/lib/zone";
import { appointmentWindow } from "./domain";
import { buildAppointmentHints, touchedDays, type HintBooking } from "./hints";

/** Hinweise im Terminformular (reine Logik): Feiertag, Öffnungszeiten, Mitternacht, Abwesenheit, weitere Termine – inklusive Zeitzonen- und Sommerzeitfälle. */
afterEach(() => resetWorkshopZone());

const window = (date: string, time: string, minutes: number, zone = "Europe/Berlin") => {
  setWorkshopZone(zone);
  return appointmentWindow(date, time, minutes)!;
};
const holidays = createHolidayCalendar({ ...NO_HOLIDAYS, region: "DE-NW", custom: [{ id: "h", name: "Heiligabend", month: 12, day: 24, year: null, half: true }] });
const kinds = (hints: ReturnType<typeof buildAppointmentHints>) => hints.map((h) => h.kind);
const base = { hours: DEFAULT_OPENING_HOURS, holidays: createHolidayCalendar(NO_HOLIDAYS), timeZone: "Europe/Berlin" };
const allDay: OpeningHours = { mon: ["00:00", "23:59"], tue: ["00:00", "23:59"], wed: ["00:00", "23:59"], thu: ["00:00", "23:59"], fri: ["00:00", "23:59"], sat: ["00:00", "23:59"], sun: ["00:00", "23:59"] };

describe("touchedDays", () => {
  it("ein Termin bis genau Mitternacht berührt den Folgetag nicht; darüber hinaus schon", () => {
    assert.deepEqual(touchedDays(window("2030-05-06", "22:00", 120), "Europe/Berlin"), ["2030-05-06"]);
    assert.deepEqual(touchedDays(window("2030-05-06", "22:00", 121), "Europe/Berlin"), ["2030-05-06", "2030-05-07"]);
  });

  it("Sommerzeit: 22:00 am 30.3.2030 plus 10 Stunden endet nach der Umstellung am 31.3. um 09:00 Ortszeit (zwei Tage)", () => {
    const w = window("2030-03-30", "22:00", 600);
    assert.deepEqual(touchedDays(w, "Europe/Berlin"), ["2030-03-30", "2030-03-31"]);
    assert.equal(new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }).format(w.endsAt), "09:00");
  });

  it("Zurückstellen: 22:00 am 26.10.2030 plus 6 Stunden endet um 03:00 Ortszeit (die Stunde 02:00–03:00 gibt es zweimal)", () => {
    const w = window("2030-10-26", "22:00", 360);
    assert.deepEqual(touchedDays(w, "Europe/Berlin"), ["2030-10-26", "2030-10-27"]);
    assert.equal(new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }).format(w.endsAt), "03:00");
  });

  it("dieselbe Eingabe in anderen Zonen: Zürich wie Berlin; in UTC erst um 23:00 UTC – und in Auckland ist derselbe Zeitpunkt schon der nächste Tag", () => {
    const berlin = window("2030-05-06", "23:00", 90, "Europe/Berlin");
    const zurich = window("2030-05-06", "23:00", 90, "Europe/Zurich");
    assert.deepEqual(touchedDays(berlin, "Europe/Berlin"), touchedDays(zurich, "Europe/Zurich"));
    const utc = window("2030-05-06", "23:00", 90, "UTC");
    assert.deepEqual(touchedDays(utc, "UTC"), ["2030-05-06", "2030-05-07"]);
    assert.deepEqual(touchedDays(utc, "Pacific/Auckland"), ["2030-05-07"]);
  });
});

describe("buildAppointmentHints", () => {
  it("ein Termin in den Öffnungszeiten an einem normalen Tag hat keine Hinweise", () => {
    assert.deepEqual(buildAppointmentHints({ ...base, window: window("2030-05-06", "09:00", 60) }), []);
  });

  it("Feiertag und halber Feiertag (eigener Tag); bei einem Termin über Mitternacht in den Feiertag hinein erscheinen beide Tage", () => {
    const hints = buildAppointmentHints({ ...base, holidays, hours: allDay, window: window("2030-12-24", "10:00", 60) });
    assert.deepEqual(hints.find((h) => h.kind === "holiday"), { kind: "holiday", day: "2030-12-24", half: true, key: null, name: "Heiligabend" });
    const night = buildAppointmentHints({ ...base, holidays, hours: allDay, window: window("2030-12-24", "23:00", 120) });
    assert.deepEqual(
      night.filter((h) => h.kind === "holiday").map((h) => (h.kind === "holiday" ? [h.day, h.key, h.half] : null)),
      [["2030-12-24", null, true], ["2030-12-25", "christmasDay", false]],
    );
  });

  it("geschlossener Tag und Zeit außerhalb der Öffnungszeiten", () => {
    // 2030-05-04 ist ein Samstag (geschlossen); Montag 07:00 liegt vor 07:30; Freitag 15:30–16:30 endet nach 16:00
    assert.deepEqual(kinds(buildAppointmentHints({ ...base, window: window("2030-05-04", "10:00", 60) })), ["closed"]);
    assert.deepEqual(buildAppointmentHints({ ...base, window: window("2030-05-06", "07:00", 60) }), [{ kind: "outsideHours", day: "2030-05-06", from: "07:30", to: "17:00" }]);
    assert.deepEqual(kinds(buildAppointmentHints({ ...base, window: window("2030-05-10", "15:30", 60) })), ["outsideHours"]);
    assert.deepEqual(buildAppointmentHints({ ...base, window: window("2030-05-06", "16:00", 60) }), [], "Ende genau zur Schlusszeit ist in Ordnung");
  });

  it("Termin über Mitternacht: Hinweis mit Ende, und jeder berührte Tag wird gegen die Öffnungszeiten geprüft", () => {
    const hints = buildAppointmentHints({ ...base, window: window("2030-05-06", "16:00", 120) });
    assert.deepEqual(kinds(hints), ["outsideHours"], "Mo 16:00–18:00: nur der Schluss um 17:00, kein Mitternachtshinweis");
    const over = buildAppointmentHints({ ...base, window: window("2030-05-09", "22:00", 480) });
    assert.deepEqual(kinds(over), ["outsideHours", "outsideHours", "crossesMidnight"], "Do 22:00 bis Fr 06:00: beide Tage außerhalb der Zeiten");
    assert.deepEqual(over.find((h) => h.kind === "crossesMidnight"), { kind: "crossesMidnight", endDay: "2030-05-10", endTime: "06:00" });
  });

  it("Zuständiger: abwesend (nie mit Art) und mit überschneidendem Termin", () => {
    const w = window("2030-05-06", "09:00", 120);
    const other: HintBooking = { title: "Ölwechsel", startsAt: window("2030-05-06", "10:00", 60).startsAt, endsAt: window("2030-05-06", "10:00", 60).endsAt, status: "confirmed" };
    const done: HintBooking = { ...other, title: "Erledigt", status: "done" };
    const hints = buildAppointmentHints({ ...base, window: w, assignee: { name: "Erika Muster", absent: true, others: [other, done] } });
    assert.deepEqual(hints[0], { kind: "assigneeAbsent", name: "Erika Muster" });
    assert.deepEqual(hints[1], { kind: "assigneeBusy", name: "Erika Muster", title: "Ölwechsel", from: "10:00", to: "11:00" });
    assert.equal(hints.length, 2, "Erledigtes zählt nicht");
    assert.ok(!JSON.stringify(hints).includes("sick"));
  });

  it("Fahrzeug mit Termin am selben Kalendertag (nicht nur genau im Zeitfenster); andere Tage, abgesagte und erledigte zählen nicht", () => {
    const w = window("2030-05-06", "09:00", 60);
    const later: HintBooking = { title: "HU", startsAt: window("2030-05-06", "14:00", 60).startsAt, endsAt: window("2030-05-06", "14:00", 60).endsAt, status: "scheduled" };
    const otherDay: HintBooking = { title: "Anderer Tag", startsAt: window("2030-05-07", "14:00", 60).startsAt, endsAt: window("2030-05-07", "14:00", 60).endsAt, status: "scheduled" };
    const cancelled: HintBooking = { ...later, title: "Abgesagt", status: "cancelled" };
    const hints = buildAppointmentHints({ ...base, window: w, vehicle: { plate: "B-AB 123", others: [later, otherDay, cancelled] } });
    assert.deepEqual(hints, [{ kind: "vehicleBooked", plate: "B-AB 123", title: "HU", day: "2030-05-06", from: "14:00", to: "15:00" }]);
  });

  it("Zonen: Samstagabend 23:30 plus eine Stunde berührt in Berlin und Zürich Samstag und Sonntag (beide geschlossen) und geht über Mitternacht", () => {
    for (const zone of ["Europe/Berlin", "Europe/Zurich"]) {
      const w = window("2030-05-04", "23:30", 60, zone);
      assert.deepEqual(kinds(buildAppointmentHints({ ...base, window: w, timeZone: zone })), ["closed", "closed", "crossesMidnight"], zone);
    }
  });
});
