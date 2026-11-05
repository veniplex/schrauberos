/** "Neue Mitarbeiter – Onboarding (IT)" -> "neue-mitarbeiter-onboarding-it"; Umlaute werden ausgeschrieben. */
export function slugify(input: string, max = 60): string {
  const slug = input
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return slug || "seite";
}

/** Hängt -2, -3 … an, bis der Slug nicht mehr in `taken` vorkommt. */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!set.has(candidate)) return candidate;
  }
}

/** Überschriften (## und ###) aus Markdown für ein Inhaltsverzeichnis; Code-Blöcke werden übersprungen. */
export function markdownHeadings(source: string): Array<{ level: 2 | 3; text: string; id: string }> {
  const out: Array<{ level: 2 | 3; text: string; id: string }> = [];
  let inFence = false;
  for (const line of source.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      const text = m[2].replace(/[*_`[\]]/g, "").trim();
      out.push({ level: m[1].length as 2 | 3, text, id: slugify(text) });
    }
  }
  return out;
}
