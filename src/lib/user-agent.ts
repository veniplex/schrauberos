/**
 * Browser und Betriebssystem aus dem User-Agent – grob und nur zur Wiedererkennung in den Listen „Meine Sitzungen“ und „Bekannte Geräte“ (kein Fingerabdruck:
 * weder Version noch Gerätemodell). `null`-Teile stehen für „unbekannt“; die Oberfläche setzt dafür ihren eigenen Text ein.
 */
export type AgentSummary = { browser: string | null; os: string | null };

// Reihenfolge ist wichtig: Edge, Opera und Samsung nennen sich auch „Chrome“, Chrome nennt sich auch „Safari“
const BROWSERS: ReadonlyArray<[RegExp, string]> = [
  [/\b(?:Edg|EdgA|EdgiOS)\//, "Edge"],
  [/\b(?:OPR|Opera)\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\b(?:Firefox|FxiOS)\//, "Firefox"],
  [/\b(?:Chrome|CriOS|Chromium)\//, "Chrome"],
  [/\bSafari\//, "Safari"],
];
const SYSTEMS: ReadonlyArray<[RegExp, string]> = [
  [/\bWindows\b/, "Windows"],
  [/\b(?:iPhone|iPad|iPod)\b/, "iOS"],
  [/\bAndroid\b/, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bLinux\b|\bX11\b/, "Linux"],
];

export function describeAgent(userAgent: string | null | undefined): AgentSummary {
  const text = (userAgent ?? "").slice(0, 300);
  return { browser: BROWSERS.find(([re]) => re.test(text))?.[1] ?? null, os: SYSTEMS.find(([re]) => re.test(text))?.[1] ?? null };
}
