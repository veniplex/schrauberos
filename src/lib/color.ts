const HEX = /^#([0-9a-f]{6})$/i;

export function isHexColor(value: string): boolean {
  return HEX.test(value);
}

function channel(v: number) {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Relative Luminanz nach WCAG. */
export function luminance(hex: string): number {
  const m = HEX.exec(hex);
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** Lesbare Textfarbe (weiß oder fast schwarz) auf einem Hintergrund. */
export function contrastInk(hex: string): string {
  const l = luminance(hex);
  const whiteContrast = 1.05 / (l + 0.05);
  const darkContrast = (l + 0.05) / (luminance("#0f172a") + 0.05);
  return whiteContrast >= darkContrast ? "#ffffff" : "#0f172a";
}

export const ACCENT_PRESETS = [
  "#2459c9", // Blau (Standard)
  "#0f766e", // Petrol
  "#15803d", // Grün
  "#c2410c", // Orange
  "#b91c1c", // Rot
  "#7e22ce", // Violett
  "#334155", // Schiefer
] as const;

/** Namen der Vorschlagsfarben (gleiche Reihenfolge wie `ACCENT_PRESETS`; Schlüssel unter `settings.workshop.accentNames`): Hilfstechnik und Sprachsteuerung nennen Farben, keine Hex-Werte. */
export const ACCENT_PRESET_NAMES = ["blue", "teal", "green", "orange", "red", "violet", "slate"] as const;
