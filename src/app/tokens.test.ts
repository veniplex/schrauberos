import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { ACCENT_PRESETS } from "@/lib/color";
import { SURFACE, accentTextContrast, accentTextCss, contrastRatio, distance, evalColor, over, readTokens, simulate, type Deficiency, type Theme } from "@/lib/color-contrast";

/**
 * Kontrast der Design-Tokens (WCAG 2.x), gerechnet aus `tokens.css` selbst – eine Farbänderung, die den Kontrast verschlechtert, bricht den Test.
 * Text mindestens 4,5 : 1, Bedienelement-Ränder und Diagrammfarben mindestens 3 : 1.
 */
const tokens = readTokens(readFileSync(path.join(process.cwd(), "src/app/tokens.css"), "utf8"));
const THEMES: Theme[] = ["light", "dark"];
const color = (name: string, theme: Theme, t = tokens) => evalColor(`var(${name})`, theme, t);
const ratio = (fg: string, bg: string, theme: Theme, t = tokens) => contrastRatio(color(fg, theme, t), color(bg, theme, t));
const TEXT = 4.5;
const UI = 3;

describe("Design-Tokens: Kontrast", () => {
  for (const theme of THEMES) {
    it(`${theme}: Text auf allen Flächen mindestens 4,5 : 1`, () => {
      for (const [fg, bg] of [
        ["--ink", "--bg"], ["--ink", "--surface"], ["--ink", "--surface-2"], ["--ink", "--surface-hover"],
        ["--ink-muted", "--bg"], ["--ink-muted", "--surface"], ["--ink-muted", "--surface-2"], ["--ink-muted", "--surface-hover"],
        ["--accent-text", "--bg"], ["--accent-text", "--surface"], ["--accent-text", "--surface-2"], ["--accent-text", "--surface-hover"], ["--accent-text", "--accent-subtle"],
        ["--accent-ink", "--accent"], ["--accent-ink", "--accent-hover"],
        ["--success-ink", "--success-bg"], ["--warning-ink", "--warning-bg"], ["--danger-ink", "--danger-bg"], ["--info-ink", "--info-bg"],
        ["--success-ink", "--surface"], ["--warning-ink", "--surface"], ["--danger-ink", "--surface"], ["--info-ink", "--surface"],
      ]) {
        assert.ok(ratio(fg, bg, theme) >= TEXT, `${theme}: ${fg} auf ${bg} = ${ratio(fg, bg, theme).toFixed(2)} (< ${TEXT})`);
      }
    });

    it(`${theme}: Platzhaltertext (ink-muted) auf Eingabefeld und Fläche`, () => {
      // .input::placeholder nutzt text-ink-muted ohne Deckkraft
      assert.ok(ratio("--ink-muted", "--surface", theme) >= TEXT);
      const withOpacity = contrastRatio(over(color("--ink-muted", theme), 0.7, color("--surface", theme)), color("--surface", theme));
      assert.ok(withOpacity < TEXT, "Gegenprobe: mit 70 % Deckkraft läge der Platzhalter unter der Grenze – deshalb ohne Deckkraft");
    });

    it(`${theme}: Rand von Bedienelementen mindestens 3 : 1 gegen Fläche und Seitenhintergrund`, () => {
      assert.ok(ratio("--control-border", "--surface", theme) >= UI, `${theme}: ${ratio("--control-border", "--surface", theme).toFixed(2)}`);
      assert.ok(ratio("--control-border", "--bg", theme) >= UI, `${theme}: auf bg ${ratio("--control-border", "--bg", theme).toFixed(2)}`);
    });

    it(`${theme}: Akzentfarbe als Text – Standard und alle Voreinstellungen ≥ 4,5 : 1 (Fläche, Seitenhintergrund, Markierung)`, () => {
      for (const accent of [tokens["--workshop-accent"] ?? "#2459c9", ...ACCENT_PRESETS]) {
        const t = { ...tokens, "--workshop-accent": accent };
        for (const bg of ["--surface", "--bg", "--accent-subtle"]) assert.ok(ratio("--accent-text", bg, theme, t) >= TEXT, `${theme}: Akzent ${accent} auf ${bg} = ${ratio("--accent-text", bg, theme, t).toFixed(2)}`);
      }
    });
  }

  it("Hell und Dunkel stehen für jedes Farb-Token da (light-dark) – keine Farbe ohne Dunkelvariante", () => {
    for (const name of ["--bg", "--surface", "--ink", "--ink-muted", "--control-border", "--success-ink", "--danger-bg", "--chart-1", "--chart-6"]) assert.match(tokens[name], /^light-dark\(/, name);
  });
});

describe("Akzentfarbe der Werkstatt (frei wählbar)", () => {
  it("die Formel und die Flächen in color-contrast.ts sind die aus tokens.css", () => {
    for (const theme of THEMES) {
      const viaTokens = evalColor("var(--accent-text)", theme, { ...tokens, "--workshop-accent": "#c2410c" });
      const viaLib = evalColor(accentTextCss("#c2410c", theme), theme, {});
      assert.ok(distance(viaTokens, viaLib) < 0.002, theme);
      assert.ok(distance(evalColor("var(--surface)", theme, tokens), evalColor(SURFACE[theme], theme, {})) < 0.002, `Fläche ${theme}`);
    }
  });
  it("blasse Akzentfarben fallen unter 4,5 : 1 (Warnung in den Einstellungen), kräftige nicht", () => {
    const pale = accentTextContrast("#ffe066");
    assert.ok(pale.light < 4.5);
    for (const accent of ACCENT_PRESETS) {
      const c = accentTextContrast(accent);
      assert.ok(Math.min(c.light, c.dark) >= 4.5, accent);
    }
  });
});

describe("Design-Tokens: Diagrammfarben", () => {
  const names = [1, 2, 3, 4, 5, 6].map((n) => `--chart-${n}`);
  for (const theme of THEMES) {
    it(`${theme}: jede Farbe mindestens 3 : 1 gegen Fläche und Seitenhintergrund`, () => {
      for (const n of names) {
        for (const bg of ["--surface", "--bg"]) assert.ok(ratio(n, bg, theme) >= UI, `${theme}: ${n} auf ${bg} = ${ratio(n, bg, theme).toFixed(2)}`);
      }
    });

    it(`${theme}: paarweise unterscheidbar – normal, Rot-/Grün-/Blau-Gelb-Schwäche`, () => {
      const colors = names.map((n) => color(n, theme));
      const modes: Array<[Deficiency | null, number]> = [[null, 0.1], ["protanopia", 0.04], ["deuteranopia", 0.04], ["tritanopia", 0.04]];
      for (const [mode, min] of modes) {
        const seen = colors.map((c) => (mode ? simulate(c, mode) : c));
        for (let i = 0; i < seen.length; i++) {
          for (let j = i + 1; j < seen.length; j++) assert.ok(distance(seen[i], seen[j]) >= min, `${theme}/${mode ?? "normal"}: ${names[i]} und ${names[j]} zu ähnlich (${distance(seen[i], seen[j]).toFixed(3)} < ${min})`);
        }
      }
    });
  }
});

describe("Typografie- und Symbol-Tokens", () => {
  it("Schriftgrößen und Symbolgrößen sind Tokens und aufsteigend", () => {
    const rem = (name: string) => Number.parseFloat(tokens[name]);
    const sizes = ["--fs-xs", "--fs-sm", "--fs-base", "--fs-lg", "--fs-xl", "--fs-2xl"].map(rem);
    assert.deepEqual([...sizes].sort((a, b) => a - b), sizes);
    assert.ok(sizes[0] >= 0.75, "kleinste Schrift nicht unter 12 px");
    assert.ok(rem("--icon-sm") < rem("--icon") && rem("--icon") < rem("--icon-lg"));
  });
});
