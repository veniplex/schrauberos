import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { contrastRatio, evalColor, readTokens, type Theme } from "@/lib/color-contrast";
import { EVENT_TINT_PERCENT, eventSurface } from "./calendar-layout";

/**
 * Kontrast der Termin-Blöcke im Kalender: Die Fläche mischt die **frei gewählte** Terminfarbe schwach in die Kartenfläche (`eventSurface`); Text darauf (`ink`, gedämpft
 * `ink-muted`) muss bei jeder denkbaren Farbe mindestens 4,5 : 1 haben – gerechnet aus `tokens.css` und derselben Funktion, die die Oberfläche benutzt (WCAG 2.x).
 * Fällt der Test, ist der Anteil `EVENT_TINT_PERCENT` zu groß.
 */
const tokens = readTokens(readFileSync(path.join(process.cwd(), "src/app/tokens.css"), "utf8"));
const WORST_CASE_COLORS = ["#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ff00ff", "#00ffff", "#808080", "#2459c9", "#7f1d1d", "#14532d", "#f59e0b"];
const THEMES: Theme[] = ["light", "dark"];

describe("Kalender: Kontrast der Termin-Blöcke", () => {
  for (const theme of THEMES) {
    it(`${theme}: Text und gedämpfter Text auf der Fläche jeder Terminfarbe mindestens 4,5 : 1`, () => {
      for (const color of WORST_CASE_COLORS) {
        const surface = evalColor(eventSurface(color), theme, tokens);
        for (const text of ["--ink", "--ink-muted"]) {
          const ratio = contrastRatio(evalColor(`var(${text})`, theme, tokens), surface);
          assert.ok(ratio >= 4.5, `${theme}: ${text} auf Terminfarbe ${color} = ${ratio.toFixed(2)} (Anteil ${EVENT_TINT_PERCENT} %)`);
        }
        // das Häkchen „erledigt“ (success-ink) ist ein Symbol mit Text daneben: mindestens 3 : 1
        assert.ok(contrastRatio(evalColor("var(--success-ink)", theme, tokens), surface) >= 3, `${theme}: Häkchen auf ${color}`);
      }
    });
  }

  it("Gegenprobe: bei 16 % läge gedämpfter Text auf Schwarz im Hellen unter der Grenze – deshalb der kleinere Anteil", () => {
    const surface = evalColor("color-mix(in oklab, #000000 16%, var(--surface))", "light", tokens);
    assert.ok(contrastRatio(evalColor("var(--ink-muted)", "light", tokens), surface) < 4.5);
  });
});
