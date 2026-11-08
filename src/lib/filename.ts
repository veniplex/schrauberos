/** Sichere, lesbare Datei- und Ordnernamen (ohne Abhängigkeiten, auch im Browser nutzbar). */

const UMLAUTS: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss", Ä: "Ae", Ö: "Oe", Ü: "Ue" };

/**
 * Namen, die unter Windows (Bind-Mount, Entwicklungsrechner) reservierte Gerätenamen sind: `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, auch mit Endung. Sie bekommen ein `_` davor.
 */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/**
 * Macht aus beliebigem Text einen sicheren Datei-/Ordnernamen (nur A–Z a–z 0–9 . _ -). Punkte stehen nie doppelt (`a..b` → `a.b`, `....` → `datei`): `resolveRel` (`server/files.ts`) lehnt `..` in Pfaden ab,
 * und ein Name wie `Foto..png` oder die Rechnungsnummer `RE..2026` ließe sonst das Speichern des Belegs scheitern (Z6-2 M3).
 */
export function safeName(input: string, max = 60): string {
  const cleaned = input
    .replace(/[äöüßÄÖÜ]/g, (c) => UMLAUTS[c])
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, max)
    .replace(/[-._]+$/g, "");
  if (!cleaned) return "datei";
  return RESERVED.test(cleaned) ? `_${cleaned}` : cleaned;
}
