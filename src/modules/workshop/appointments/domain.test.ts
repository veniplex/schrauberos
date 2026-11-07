import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { APPOINTMENT_STATUSES } from "./constants";
import { appointmentWindow, BAY_FREE_STATUSES, findBayClash, intervalsOverlap, occupiesBay, quickStatusOptions, type BayBooking } from "./domain";

/** Terminkonflikt-Logik (reine Funktionen): Zeitfenster aus Formularwerten und Doppelbelegung eines Arbeitsplatzes. */
const at = (hhmm: string) => new Date(`2030-05-06T${hhmm}:00`);
const slot = (from: string, to: string) => ({ startsAt: at(from), endsAt: at(to) });
const booking = (id: string, from: string, to: string, extra: Partial<BayBooking> = {}): BayBooking => ({ id, bayId: "bay-1", status: "scheduled", ...slot(from, to), ...extra });

describe("appointmentWindow", () => {
  it("rechnet Ende aus Beginn und Dauer", () => {
    const w = appointmentWindow("2030-05-06", "09:30", 90)!;
    assert.equal(w.startsAt.getHours() * 60 + w.startsAt.getMinutes(), 9 * 60 + 30);
    assert.equal((w.endsAt.getTime() - w.startsAt.getTime()) / 60_000, 90);
  });
  it("liefert null bei ungültigem Datum, Uhrzeit oder Dauer", () => {
    assert.equal(appointmentWindow("2030-02-30", "09:00", 60), null);
    assert.equal(appointmentWindow("2030-05-06", "99:00", 60), null);
    assert.equal(appointmentWindow("2030-05-06", "09:00", 0), null);
    assert.equal(appointmentWindow("2030-05-06", "09:00", -15), null);
    assert.equal(appointmentWindow("2030-05-06", "09:00", 1.5), null);
  });
  it("kann über Mitternacht hinausgehen", () => {
    const w = appointmentWindow("2030-05-06", "23:30", 120)!;
    assert.equal(w.endsAt.getDate(), 7);
  });
});

describe("intervalsOverlap", () => {
  it("halboffen: Anschluss ohne Lücke ist keine Überschneidung", () => {
    assert.equal(intervalsOverlap(slot("09:00", "10:00"), slot("10:00", "11:00")), false);
    assert.equal(intervalsOverlap(slot("10:00", "11:00"), slot("09:00", "10:00")), false);
  });
  it("erkennt Teilüberschneidung, Einschluss und Gleichheit – in beide Richtungen", () => {
    const cases: Array<[ReturnType<typeof slot>, ReturnType<typeof slot>]> = [
      [slot("09:00", "10:00"), slot("09:59", "11:00")],
      [slot("09:00", "12:00"), slot("10:00", "11:00")],
      [slot("09:00", "10:00"), slot("09:00", "10:00")],
      [slot("09:30", "10:30"), slot("09:00", "10:00")],
    ];
    for (const [a, b] of cases) {
      assert.equal(intervalsOverlap(a, b), true);
      assert.equal(intervalsOverlap(b, a), true);
    }
  });
  it("getrennte Fenster überschneiden sich nicht", () => {
    assert.equal(intervalsOverlap(slot("08:00", "09:00"), slot("10:00", "11:00")), false);
  });
});

describe("occupiesBay", () => {
  it("abgesagt und nicht erschienen geben den Platz frei, alles andere belegt ihn", () => {
    assert.deepEqual([...BAY_FREE_STATUSES].sort(), ["cancelled", "no_show"]);
    for (const status of ["scheduled", "confirmed", "in_progress", "done"]) assert.equal(occupiesBay(status), true, status);
    for (const status of ["cancelled", "no_show"]) assert.equal(occupiesBay(status), false, status);
  });
});

describe("findBayClash", () => {
  const candidate = (from: string, to: string, extra: Record<string, unknown> = {}) => ({ bayId: "bay-1", status: "scheduled", ...slot(from, to), ...extra });

  it("findet die Doppelbelegung desselben Arbeitsplatzes", () => {
    const other = booking("a", "09:00", "10:00");
    assert.equal(findBayClash(candidate("09:30", "10:30"), [other]), other);
  });
  it("Anschlusstermine kollidieren nicht", () => {
    assert.equal(findBayClash(candidate("10:00", "11:00"), [booking("a", "09:00", "10:00")]), null);
  });
  it("ein anderer Arbeitsplatz kollidiert nicht; Termine ohne Arbeitsplatz auch nicht", () => {
    assert.equal(findBayClash(candidate("09:00", "10:00"), [booking("a", "09:00", "10:00", { bayId: "bay-2" })]), null);
    assert.equal(findBayClash(candidate("09:00", "10:00"), [booking("a", "09:00", "10:00", { bayId: null })]), null);
    assert.equal(findBayClash({ bayId: null, status: "scheduled", ...slot("09:00", "10:00") }, [booking("a", "09:00", "10:00")]), null);
  });
  it("abgesagte oder nicht erschienene Termine blockieren nicht – und der neue Termin blockiert auch nicht, wenn er selbst abgesagt ist", () => {
    for (const status of ["cancelled", "no_show"]) {
      assert.equal(findBayClash(candidate("09:00", "10:00"), [booking("a", "09:00", "10:00", { status })]), null, `bestehend ${status}`);
      assert.equal(findBayClash(candidate("09:00", "10:00", { status }), [booking("a", "09:00", "10:00")]), null, `neu ${status}`);
    }
  });
  it("beim Ändern kollidiert ein Termin nicht mit sich selbst", () => {
    assert.equal(findBayClash(candidate("09:00", "10:30", { id: "a" }), [booking("a", "09:00", "10:00")]), null);
    assert.notEqual(findBayClash(candidate("09:00", "10:30", { id: "b" }), [booking("a", "09:00", "10:00")]), null);
  });
  it("mehrere Treffer: der früheste wird gemeldet", () => {
    const early = booking("early", "09:00", "10:00");
    const late = booking("late", "10:00", "11:00");
    assert.equal(findBayClash(candidate("09:30", "10:30"), [late, early]), early);
  });
  it("erhält zusätzliche Felder des Treffers (z. B. Fahrzeug für die Meldung)", () => {
    const hit = findBayClash(candidate("09:00", "10:00"), [{ ...booking("a", "09:00", "10:00"), title: "HU", vehicle: { plate: "B AB 1" } }]);
    assert.equal(hit?.vehicle.plate, "B AB 1");
  });
});

describe("Zeitumstellung (Europe/Berlin)", () => {
  const before0 = process.env.TZ;
  before(() => {
    process.env.TZ = "Europe/Berlin";
  });
  after(() => {
    if (before0 === undefined) delete process.env.TZ;
    else process.env.TZ = before0;
  });

  it("lehnt eine Ortszeit ab, die es nicht gibt (Lücke der Sommerzeit am 31.03.2030 von 02:00 bis 03:00) – statt still auf 03:30 zu verschieben", () => {
    for (const time of ["02:00", "02:30", "02:59"]) assert.equal(appointmentWindow("2030-03-31", time, 60), null, time);
    assert.ok(appointmentWindow("2030-03-31", "01:59", 60));
    assert.ok(appointmentWindow("2030-03-31", "03:00", 60));
    // ein anderer Tag mit derselben Uhrzeit ist unauffällig
    assert.ok(appointmentWindow("2030-03-30", "02:30", 60));
    assert.ok(appointmentWindow("2030-04-01", "02:30", 60));
  });

  it("nimmt doppelt vorkommende Zeiten beim Zurückstellen (27.10.2030, 02:00–03:00 gibt es zweimal) an", () => {
    const w = appointmentWindow("2030-10-27", "02:30", 30);
    assert.ok(w);
    assert.equal(w.startsAt.getHours(), 2);
    assert.equal(w.startsAt.getMinutes(), 30);
  });

  it("rechnet die Dauer in echten Minuten über die Umstellung: 01:30 + 60 min endet um 03:30 Ortszeit", () => {
    const w = appointmentWindow("2030-03-31", "01:30", 120)!;
    assert.equal(w.endsAt.getHours(), 4, "120 echte Minuten ab 01:30 (MEZ) sind 04:30 MESZ");
    assert.equal(w.endsAt.getMinutes(), 30);
  });
});

describe("quickStatusOptions (Schnellstatus)", () => {
  it("Geplant/Bestätigt: Starten oder gleich Fertig; In Arbeit: Fertig", () => {
    assert.deepEqual(quickStatusOptions("scheduled"), ["in_progress", "done"]);
    assert.deepEqual(quickStatusOptions("confirmed"), ["in_progress", "done"]);
    assert.deepEqual(quickStatusOptions("in_progress"), ["done"]);
  });
  it("Erledigt, Storniert, Nicht erschienen und Unbekanntes haben keinen Schnellschritt", () => {
    for (const status of ["done", "cancelled", "no_show", "irgendwas"]) assert.deepEqual(quickStatusOptions(status), [], status);
  });
  it("jeder Zustand ist bedacht: Schritte führen nie in einen Zustand, der sie wieder anbietet", () => {
    for (const status of APPOINTMENT_STATUSES) for (const next of quickStatusOptions(status)) assert.notEqual(next, status);
  });
});
