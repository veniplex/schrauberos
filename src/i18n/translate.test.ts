import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { de } from "./messages/de";
import { en } from "./messages/en";
import { createTranslator } from "./translate";

/** Platzhalter und Formatierer der Übersetzung (`{name}`, `{name|time}`). */
describe("Übersetzung: Platzhalter", () => {
  it("ersetzt {name} und lässt unbekannte Platzhalter stehen", () => {
    const { t } = createTranslator("de", de);
    assert.equal(t("common.limited", { limit: 5 }), "angezeigt werden die ersten 5");
    assert.equal(t("common.limited"), "angezeigt werden die ersten {limit}");
  });

  it("{name|time} formatiert einen Zeitpunkt als Uhrzeit der Sprache (Zeitzone des Prozesses) – der Operationskern gibt nur den Zeitpunkt weiter (ZP2-Q-7)", () => {
    const before = process.env.TZ;
    process.env.TZ = "Europe/Berlin";
    try {
      const at = new Date("2030-06-03T07:00:00Z"); // 09:00 Uhr in Berlin (Sommerzeit)
      const vars = { from: at.toISOString(), to: new Date(at.getTime() + 90 * 60_000).toISOString(), title: "B-AB 1" };
      assert.equal(createTranslator("de", de).t("appointments.errors.bayBusy", vars), "Arbeitsplatz ist von 09:00 bis 10:30 belegt (B-AB 1).");
      assert.equal(createTranslator("en", en).t("appointments.errors.bayBusy", vars), "Bay is occupied from 09:00 to 10:30 (B-AB 1).");
      // ein Zeitpunkt als Zahl geht ebenso; Unsinn bleibt, wie er ist
      assert.equal(createTranslator("de", de).t("appointments.errors.bayBusy", { ...vars, from: at.getTime() }), "Arbeitsplatz ist von 09:00 bis 10:30 belegt (B-AB 1).");
      assert.match(createTranslator("de", de).t("appointments.errors.bayBusy", { ...vars, from: "kein-datum" }), /von kein-datum bis/);
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });
});
