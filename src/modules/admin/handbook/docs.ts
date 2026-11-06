import "server-only";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { slugify } from "@/lib/slug";

/** Das Handbuch besteht aus den Markdown-Dateien im Ordner `docs/` (Dateiname `NN-name.md`). */
const DOCS_DIR = path.join(process.cwd(), "docs");

export type HandbookPage = { slug: string; title: string; body: string; headings: Array<{ level: 2 | 3; text: string; id: string }> };

const slugOf = (file: string) => file.replace(/^\d+-/, "").replace(/\.md$/, "");

/** Zeilen außerhalb von Code-Blöcken. */
function* proseLines(source: string) {
  let fenced = false;
  for (const line of source.split("\n")) {
    if (line.startsWith("```")) fenced = !fenced;
    else if (!fenced) yield line;
  }
}

function parse(slug: string, source: string): HandbookPage {
  const headings: HandbookPage["headings"] = [];
  let title = slug;
  for (const line of proseLines(source)) {
    const h1 = /^#\s+(.+)$/.exec(line);
    if (h1 && title === slug) title = h1[1].trim();
    const h = /^(#{2,3})\s+(.+)$/.exec(line);
    if (h) headings.push({ level: h[1].length as 2 | 3, text: h[2].trim(), id: slugify(h[2].trim()) });
  }
  // Die Überschrift der Seite steht im Seitenkopf – nicht doppelt im Text
  return { slug, title, body: source.replace(/^#\s+.+\n+/, ""), headings };
}

async function files() {
  const all = await readdir(DOCS_DIR).catch(() => [] as string[]);
  return all.filter((f) => /^\d+-[a-z0-9-]+\.md$/.test(f)).sort();
}

export async function listHandbook(): Promise<Array<{ slug: string; title: string }>> {
  const pages = await Promise.all((await files()).map(async (f) => parse(slugOf(f), await readFile(path.join(DOCS_DIR, f), "utf8"))));
  return pages.map(({ slug, title }) => ({ slug, title }));
}

/** Liefert null für unbekannte Seiten. Der Dateiname wird nie aus der Eingabe gebildet, sondern nur aus der Dateiliste gewählt. */
export async function readHandbookPage(slug: string): Promise<HandbookPage | null> {
  const file = (await files()).find((f) => slugOf(f) === slug);
  if (!file) return null;
  return parse(slug, await readFile(path.join(DOCS_DIR, file), "utf8"));
}
