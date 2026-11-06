import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BASELINE_MARKER, BASELINE_NAME } from "./migration-guard";

/**
 * Eingefrorene (veröffentlichte) Migrationen: Ab der Veröffentlichung dürfen Baseline und alle veröffentlichten Migrationen nie mehr geändert
 * werden – Web-Updates und bestehende Installationen hängen an ihren Prüfsummen. Das erzwingen zwei Dinge:
 *
 *  - Die Baseline trägt in der ersten Zeile `-- schrauberos:baseline frozen sha256:<Prüfsumme>` (Prüfsumme des Rumpfes, also ohne diese Zeile).
 *  - Spätere, veröffentlichte Migrationen stehen mit ihrer Prüfsumme in `prisma/published-migrations.json`.
 *
 * `npm test` prüft beides (`verifyMigrations`); `npm run db:freeze` setzt/ergänzt sie beim Veröffentlichen, und die Pipeline verlangt bei einem
 * Versions-Tag zusätzlich den Zustand „alles eingefroren“ und vergleicht mit dem letzten eingefrorenen Release-Tag (`compareToRelease`: nur Neues darf hinzukommen).
 * Vor der Veröffentlichung (`unreleased`) darf die Baseline mit `npm run db:baseline` neu erzeugt werden.
 */
export const PUBLISHED_FILE = "published-migrations.json";

export type BaselineState = { state: "unreleased" } | { state: "frozen"; sha256: string | null };

/** Zeilenenden vereinheitlichen: Eine Prüfsumme darf nicht davon abhängen, ob Git die Datei unter Windows mit CRLF ausgecheckt hat. */
const normalize = (text: string) => text.replace(/\r\n/g, "\n");
export const digestOf = (text: string) => createHash("sha256").update(normalize(text)).digest("hex");

/** Rumpf der Baseline: alles nach der ersten (Marker-)Zeile. */
export function baselineBody(sql: string): string {
  const text = normalize(sql);
  const newline = text.indexOf("\n");
  return newline === -1 ? "" : text.slice(newline + 1);
}

/** Liest den Marker der ersten Zeile; `null`, wenn er fehlt. */
export function parseBaselineMarker(sql: string): BaselineState | null {
  const first = normalize(sql).split("\n", 1)[0];
  if (!first.startsWith(BASELINE_MARKER)) return null;
  const rest = first.slice(BASELINE_MARKER.length).trim();
  if (/^unreleased\b/.test(rest)) return { state: "unreleased" };
  const frozen = /^frozen\b(?:\s+sha256:([0-9a-f]{64}))?/.exec(rest);
  if (frozen) return { state: "frozen", sha256: frozen[1] ?? null };
  return null;
}

/** Erste Zeile der eingefrorenen Baseline. */
export const frozenMarkerLine = (sha256: string) => `${BASELINE_MARKER} frozen sha256:${sha256}`;

type Layout = { dir: string; publishedFile: string };

const sqlOf = (dir: string, name: string) => readFileSync(path.join(dir, name, "migration.sql"), "utf8");
const migrationNames = (dir: string) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

export function readPublished(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
}

/**
 * Prüft den Zustand der Migrationen und liefert die Probleme (leer = in Ordnung).
 * Mit `release: true` (Pipeline bei einem Versions-Tag) muss zusätzlich alles eingefroren sein.
 */
export function verifyMigrations({ dir, publishedFile }: Layout, options: { release?: boolean } = {}): string[] {
  const problems: string[] = [];
  const names = existsSync(dir) ? migrationNames(dir) : [];
  if (names[0] !== BASELINE_NAME) return [`Die erste Migration muss ${BASELINE_NAME} sein.`];
  const baseline = sqlOf(dir, BASELINE_NAME);
  const marker = parseBaselineMarker(baseline);
  const published = readPublished(publishedFile);

  if (!marker) problems.push(`Die erste Zeile der Baseline muss den Marker „${BASELINE_MARKER} unreleased|frozen“ tragen.`);
  else if (marker.state === "unreleased") {
    if (options.release) problems.push("Die Baseline ist noch nicht eingefroren (unreleased): vor dem Versions-Tag npm run db:freeze ausführen und committen.");
    if (Object.keys(published).length) problems.push(`${PUBLISHED_FILE} nennt veröffentlichte Migrationen, die Baseline ist aber „unreleased“.`);
  } else if (!marker.sha256) {
    problems.push("Die eingefrorene Baseline trägt keine Prüfsumme (frozen sha256:…): npm run db:freeze.");
  } else if (marker.sha256 !== digestOf(baselineBody(baseline))) {
    problems.push("Die eingefrorene Baseline wurde verändert (Prüfsumme stimmt nicht). Veröffentlichte Migrationen werden nie geändert – Schema-Änderungen nur als neue, additive Migration (npm run db:migrate -- <name>).");
  }

  for (const [name, sha] of Object.entries(published)) {
    if (!names.includes(name)) problems.push(`Veröffentlichte Migration ${name} fehlt oder wurde umbenannt.`);
    else if (digestOf(sqlOf(dir, name)) !== sha) problems.push(`Veröffentlichte Migration ${name} wurde verändert (Prüfsumme stimmt nicht).`);
  }
  if (options.release) {
    for (const name of names.slice(1)) if (!(name in published)) problems.push(`Migration ${name} ist nicht als veröffentlicht eingetragen: npm run db:freeze.`);
  }
  return problems;
}

export type FreezeResult = { baselineFrozen: boolean; added: string[] };

/**
 * Friert den aktuellen Stand ein: setzt den Marker der Baseline auf `frozen sha256:…` und trägt alle noch nicht erfassten Migrationen mit Prüfsumme ein.
 * Bereits erfasste Einträge werden nie überschrieben (stimmt eine nicht mehr, bricht es ab).
 */
export function freezeMigrations({ dir, publishedFile }: Layout): FreezeResult {
  const before = verifyMigrations({ dir, publishedFile });
  if (before.length) throw new Error(before.join("\n"));
  const file = path.join(dir, BASELINE_NAME, "migration.sql");
  const baseline = readFileSync(file, "utf8");
  let baselineFrozen = false;
  if (parseBaselineMarker(baseline)?.state === "unreleased") {
    const body = baselineBody(baseline);
    writeFileSync(file, `${frozenMarkerLine(digestOf(body))}\n${body}`);
    baselineFrozen = true;
  }
  const published = readPublished(publishedFile);
  const added: string[] = [];
  for (const name of migrationNames(dir).slice(1)) {
    if (name in published) continue;
    published[name] = digestOf(sqlOf(dir, name));
    added.push(name);
  }
  const sorted = Object.fromEntries(Object.entries(published).sort(([a], [b]) => a.localeCompare(b)));
  if (added.length || existsSync(publishedFile)) writeFileSync(publishedFile, `${JSON.stringify(sorted, null, 2)}\n`);
  return { baselineFrozen, added };
}

/**
 * Vergleich mit dem letzten eingefrorenen Release (Ausgabe von `git diff --name-status --no-renames <Tag> HEAD -- prisma/migrations`):
 * Hinzugekommene Dateien sind in Ordnung, jede Änderung oder Löschung einer veröffentlichten Datei nicht.
 */
export function compareToRelease(nameStatus: string): string[] {
  const problems: string[] = [];
  for (const line of nameStatus.split(/\r?\n/).filter(Boolean)) {
    const [status, ...rest] = line.split("\t");
    if (status !== "A") problems.push(`${rest.join(" ")}: seit dem letzten Release ${status === "D" ? "gelöscht" : "verändert"} (Status ${status}) – veröffentlichte Migrationen bleiben unverändert.`);
  }
  return problems;
}
