import "server-only";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { slugify } from "@/lib/slug";

/**
 * Die Hilfe (Anwendungsdokumentation) besteht aus Markdown-Dateien im Ordner `docs/`:
 *  - `docs/platform/NN-name.md`: allgemeine Kapitel der Plattform, immer sichtbar,
 *  - `docs/<modul>/<funktion>.md` u. a.: Kapitel der Funktionen, von diesen über `help.ts` angemeldet (sichtbar nur bei aktiver Funktion).
 */
const DOCS_DIR = path.join(process.cwd(), "docs");
const PLATFORM_DIR = "platform";

/** Ein Kapitel: `id` ist die Adresse (`/help/<id>`), `doc` die Datei unter `docs/` ohne `.md`. */
export type HelpTopicRef = { id: string; doc: string };
export type HelpPage = { title: string; body: string; headings: Array<{ level: 2 | 3; text: string; id: string }> };

/** Zeilen außerhalb von Code-Blöcken. */
function* proseLines(source: string) {
  let fenced = false;
  for (const line of source.split("\n")) {
    if (line.startsWith("```")) fenced = !fenced;
    else if (!fenced) yield line;
  }
}

function parse(source: string): HelpPage {
  const headings: HelpPage["headings"] = [];
  let title = "";
  for (const line of proseLines(source)) {
    const h1 = /^#\s+(.+)$/.exec(line);
    if (h1 && !title) title = h1[1].trim();
    const h = /^(#{2,3})\s+(.+)$/.exec(line);
    if (h) headings.push({ level: h[1].length as 2 | 3, text: h[2].trim(), id: slugify(h[2].trim()) });
  }
  // Die Überschrift der Seite steht im Seitenkopf – nicht doppelt im Text
  return { title, body: source.replace(/^#\s+.+\n+/, ""), headings };
}

/** Die allgemeinen Kapitel der Plattform in Dateireihenfolge (`NN-` bestimmt sie und gehört nicht zur Adresse). */
export async function platformTopics(): Promise<HelpTopicRef[]> {
  const all = await readdir(path.join(DOCS_DIR, PLATFORM_DIR)).catch(() => [] as string[]);
  return all
    .filter((f) => /^\d+-[a-z0-9-]+\.md$/.test(f))
    .sort()
    .map((f) => {
      const name = f.replace(/^\d+-/, "").replace(/\.md$/, "");
      return { id: name, doc: `${PLATFORM_DIR}/${f.replace(/\.md$/, "")}` };
    });
}

/**
 * Liest ein Kapitel; null, wenn es die Datei nicht gibt. `doc` stammt immer aus der Plattform-Dateiliste oder aus den Hilfe-Themen der
 * Funktionen – nie aus einer Benutzereingabe –, die Form wird trotzdem geprüft.
 */
export async function readHelpPage(doc: string): Promise<HelpPage | null> {
  if (!/^[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(doc)) return null;
  const source = await readFile(path.join(DOCS_DIR, `${doc}.md`), "utf8").catch(() => null);
  return source === null ? null : parse(source);
}
