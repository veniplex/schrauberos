/** Sichere, lesbare Datei- und Ordnernamen (ohne Abhängigkeiten, auch im Browser nutzbar). */

const UMLAUTS: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss", Ä: "Ae", Ö: "Oe", Ü: "Ue" };

/** Macht aus beliebigem Text einen sicheren Datei-/Ordnernamen (nur A–Z a–z 0–9 . _ -). */
export function safeName(input: string, max = 60): string {
  const cleaned = input
    .replace(/[äöüßÄÖÜ]/g, (c) => UMLAUTS[c])
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, max)
    .replace(/[-._]+$/g, "");
  return cleaned || "datei";
}
