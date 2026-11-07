/**
 * Farbrechnung für die Kontrastprüfung der Design-Tokens (nur Tests und Werkzeuge – die Oberfläche selbst rechnet nichts).
 * Versteht, was `tokens.css` benutzt: `#rrggbb`, `oklch(L% C H [/ a])`, `color-mix(in oklab, A p%, B)`, `var(--name)` und `light-dark(hell, dunkel)`.
 * Kontrast nach WCAG 2.x (relative Luminanz, sRGB).
 */
export type Rgb = { r: number; g: number; b: number };
type Lab = { L: number; a: number; b: number };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/** sRGB (0–1, gamma-codiert) → OKLab */
export function rgbToOklab({ r, g, b }: Rgb): Lab {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return { L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s };
}

/** OKLab → sRGB (0–1); außerhalb des Farbraums wird je Kanal abgeschnitten (so zeigt es auch der Browser, ohne Gamut-Mapping der Anwendung). */
export function oklabToRgb({ L, a, b }: Lab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  const [r, g, bb] = lin.map((v) => fromLinear(clamp01(v)));
  return { r, g, b: bb };
}

export function luminanceOf({ r, g, b }: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** Kontrastverhältnis zweier Farben (1–21). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminanceOf(a), luminanceOf(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Abstand zweier Farben im OKLab (≈ wahrgenommener Unterschied; 0,02 ≈ gerade bemerkbar, ≥ 0,08 gut unterscheidbar). */
export function distance(a: Rgb, b: Rgb): number {
  const [x, y] = [rgbToOklab(a), rgbToOklab(b)];
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);
}

/** Überlagert `fg` mit Deckkraft `alpha` über `bg`. */
export function over(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return { r: fg.r * alpha + bg.r * (1 - alpha), g: fg.g * alpha + bg.g * (1 - alpha), b: fg.b * alpha + bg.b * (1 - alpha) };
}

/** Simulation von Farbfehlsichtigkeit (Viénot/Brettel-Matrizen im linearen RGB) – für die Unterscheidbarkeit der Diagrammfarben. */
export type Deficiency = "protanopia" | "deuteranopia" | "tritanopia";
const CVD: Record<Deficiency, number[][]> = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
export function simulate({ r, g, b }: Rgb, kind: Deficiency): Rgb {
  const v = [toLinear(r), toLinear(g), toLinear(b)];
  const m = CVD[kind];
  const [rr, gg, bb] = m.map((row) => fromLinear(clamp01(row[0] * v[0] + row[1] * v[1] + row[2] * v[2])));
  return { r: rr, g: gg, b: bb };
}

/* ───────────── CSS-Werte ───────────── */

/** Teilt an Kommas der obersten Ebene (nicht in Klammern). */
function splitTop(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export type Theme = "light" | "dark";
export type Tokens = Record<string, string>;

/**
 * Wertet einen CSS-Farbwert für ein Thema aus. `tokens` sind die Custom Properties (`--name` → Rohwert); `var()` wird aufgelöst,
 * `light-dark()` nach Thema entschieden. Liefert Farbe und Deckkraft (nur `oklch(… / a)`).
 */
export function evalColor(value: string, theme: Theme, tokens: Tokens, depth = 0): Rgb & { alpha: number } {
  if (depth > 12) throw new Error(`Zu tief verschachtelt: ${value}`);
  const v = value.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, alpha: 1 };
  }
  if (v === "white") return { r: 1, g: 1, b: 1, alpha: 1 };
  if (v === "black") return { r: 0, g: 0, b: 0, alpha: 1 };
  const call = /^([a-z-]+)\(([\s\S]*)\)$/.exec(v);
  if (!call) throw new Error(`Unbekannter Farbwert: ${value}`);
  const [, fn, body] = call;
  if (fn === "var") {
    const [name, fallback] = splitTop(body);
    const raw = tokens[name];
    if (raw === undefined) {
      if (fallback === undefined) throw new Error(`Token fehlt: ${name}`);
      return evalColor(fallback, theme, tokens, depth + 1);
    }
    return evalColor(raw, theme, tokens, depth + 1);
  }
  if (fn === "light-dark") {
    const [light, dark] = splitTop(body);
    return evalColor(theme === "light" ? light : dark, theme, tokens, depth + 1);
  }
  if (fn === "oklch") {
    const m = /^([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+)(%?))?$/.exec(body.trim());
    if (!m) throw new Error(`oklch nicht lesbar: ${value}`);
    const L = Number(m[1]) / (m[2] ? 100 : 1);
    const C = Number(m[3]);
    const H = (Number(m[4]) * Math.PI) / 180;
    const alpha = m[5] === undefined ? 1 : Number(m[5]) / (m[6] ? 100 : 1);
    return { ...oklabToRgb({ L, a: C * Math.cos(H), b: C * Math.sin(H) }), alpha };
  }
  if (fn === "color-mix") {
    const [space, ...parts] = splitTop(body);
    if (space !== "in oklab") throw new Error(`color-mix nur in oklab: ${value}`);
    const stops = parts.map((p) => {
      const m = /^([\s\S]*?)(?:\s+([\d.]+)%)?$/.exec(p.trim())!;
      return { color: evalColor(m[1], theme, tokens, depth + 1), pct: m[2] === undefined ? undefined : Number(m[2]) / 100 };
    });
    const [a, b] = stops;
    const pa = a.pct ?? (b.pct === undefined ? 0.5 : 1 - b.pct);
    const la = rgbToOklab(a.color);
    const lb = rgbToOklab(b.color);
    const mixed = oklabToRgb({ L: la.L * pa + lb.L * (1 - pa), a: la.a * pa + lb.a * (1 - pa), b: la.b * pa + lb.b * (1 - pa) });
    return { ...mixed, alpha: a.color.alpha * pa + b.color.alpha * (1 - pa) };
  }
  throw new Error(`Unbekannte Funktion ${fn}()`);
}

/** Liest die Custom Properties aus dem `:root`-Block einer CSS-Datei (erste Deklaration gewinnt, Kommentare entfernt). */
export function readTokens(css: string): Tokens {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(stripped);
  if (!root) throw new Error(":root nicht gefunden");
  const out: Tokens = {};
  const body = root[1];
  let i = 0;
  while (i < body.length) {
    const start = body.indexOf("--", i);
    if (start < 0) break;
    const colon = body.indexOf(":", start);
    let depth = 0;
    let end = colon + 1;
    for (; end < body.length; end++) {
      if (body[end] === "(") depth++;
      else if (body[end] === ")") depth--;
      else if (body[end] === ";" && depth === 0) break;
    }
    const name = body.slice(start, colon).trim();
    if (!(name in out)) out[name] = body.slice(colon + 1, end).replace(/\s+/g, " ").trim();
    i = end + 1;
  }
  return out;
}

/* ───────────── Akzentfarbe der Werkstatt ───────────── */

/** Flächen, auf denen Akzent-Text steht (Werte aus tokens.css; `tokens.test.ts` prüft, dass sie übereinstimmen). */
export const SURFACE = { light: "oklch(100% 0 0)", dark: "oklch(21% 0.014 255)" } as const;
/** So bildet tokens.css die Textfarbe aus der Akzentfarbe (`--accent-text`). */
export const accentTextCss = (hex: string, theme: Theme) => (theme === "light" ? `color-mix(in oklab, ${hex} 88%, black)` : `color-mix(in oklab, ${hex} 55%, white)`);

/**
 * Kontrast der aus einer frei gewählten Akzentfarbe abgeleiteten Textfarbe gegen die Fläche, in Hell und Dunkel. Unter 4,5 ist der Akzent als Textfarbe
 * (Links, aktive Reiter, Markierungen) schwer lesbar – die Einstellungen warnen dann.
 */
export function accentTextContrast(hex: string): { light: number; dark: number } {
  const at = (theme: Theme) => contrastRatio(evalColor(accentTextCss(hex, theme), theme, {}), evalColor(SURFACE[theme], theme, {}));
  return { light: at("light"), dark: at("dark") };
}
