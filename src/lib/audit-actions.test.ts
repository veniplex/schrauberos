import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { de } from "@/i18n/messages/de";
import { en } from "@/i18n/messages/en";
import { ALL_PERMISSIONS } from "@/modules/catalog";
import { AUDIT_ACTIONS, AUDIT_GROUPS, FEATURE_AUDIT_ACTIONS, PLATFORM_AUDIT_ACTIONS } from "./audit-actions";

/**
 * Registrierung der Audit-Aktionen: Jede Funktion meldet ihre Aktionen in der `feature.ts` an (`auditActions`), die Plattform ihre in `PLATFORM_AUDIT_ACTIONS`.
 * Jede Aktion gehört genau einer Stelle, wird verwendet (keine Waisen) und hat in beiden Sprachen eine Beschriftung (und umgekehrt: keine Beschriftung ohne Aktion).
 */
const SRC = path.resolve(process.cwd(), "src");
const rel = (file: string) => path.relative(SRC, file).split(path.sep).join("/");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "generated" || name === "node_modules") return [];
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

/** Quelltexte, die eine Aktion tatsächlich verwenden könnten (nicht: Deklarationen und Beschriftungen). */
const sources = walk(SRC)
  .map((file) => ({ file: rel(file), text: readFileSync(file, "utf8") }))
  .filter(({ file }) => file !== "lib/audit-actions.ts" && !/^modules\/[a-z0-9-]+\/[a-z0-9-]+\/feature\.ts$/.test(file) && !file.startsWith("i18n/"));
const usedIn = (action: string) => sources.filter(({ text }) => text.includes(`"${action}"`) || text.includes(`'${action}'`) || text.includes(`\`${action}\``)).map(({ file }) => file);

describe("Audit-Aktionen: Registrierung", () => {
  it("jede Aktion gehört genau einer Stelle (einer Funktion oder der Plattform), keine doppelt", () => {
    const platform = new Set<string>(PLATFORM_AUDIT_ACTIONS);
    assert.equal(platform.size, PLATFORM_AUDIT_ACTIONS.length, "doppelt in PLATFORM_AUDIT_ACTIONS");
    const clash = [...FEATURE_AUDIT_ACTIONS.keys()].filter((a) => platform.has(a));
    assert.deepEqual(clash, [], "gehört der Plattform und einer Funktion");
    assert.equal(AUDIT_ACTIONS.length, platform.size + FEATURE_AUDIT_ACTIONS.size);
  });

  it("jede Funktion meldet ihre Aktionen nur einmal an (auch nicht bei zwei Funktionen)", async () => {
    const { FEATURES } = await import("@/modules/catalog");
    const owners = new Map<string, string>();
    const problems: string[] = [];
    for (const f of FEATURES) {
      const id = `${f.module}.${f.id}`;
      const list = ("auditActions" in f ? f.auditActions : []) as readonly string[];
      for (const a of list) {
        if (owners.has(a)) problems.push(`${a}: ${owners.get(a)} und ${id}`);
        else owners.set(a, id);
        if (!/^[a-zA-Z]+\.[a-zA-Z]+$/.test(a)) problems.push(`${id}: ${a} ist keine Aktion der Form gruppe.aktion`);
      }
    }
    assert.deepEqual(problems, []);
  });

  it("keine verwaiste Aktion: jede wird im Code verwendet", () => {
    const orphans = AUDIT_ACTIONS.filter((a) => usedIn(a).length === 0);
    assert.deepEqual(orphans, [], "angemeldet, aber nirgends geschrieben – streichen oder verwenden");
  });

  it("Aktionen einer Funktion werden nur von ihr selbst (oder der Plattform) geschrieben, nie von einer anderen Funktion", () => {
    const foreign: string[] = [];
    const permissions = new Set<string>(ALL_PERMISSIONS);
    for (const [action, owner] of FEATURE_AUDIT_ACTIONS) {
      if (permissions.has(action)) continue; // gleicher Name wie ein Recht (tires.stock): die Zeichenkette allein sagt nichts über die Verwendung
      const [module, feature] = owner.split(".");
      for (const file of usedIn(action)) {
        const m = /^modules\/([a-z0-9-]+)\/([a-z0-9-]+)\//.exec(file);
        if (m && !(m[1] === module && m[2] === feature)) foreign.push(`${action} (${owner}) in ${file}`);
      }
    }
    assert.deepEqual(foreign, []);
  });

  it("Aktionen der Plattform werden von keiner Funktion neu erfunden: jede Aktion in `audit:` einer Operation ist angemeldet", () => {
    const known = new Set<string>(AUDIT_ACTIONS);
    const unknown: string[] = [];
    for (const { file, text } of sources) {
      for (const m of text.matchAll(/\baudit:\s*"([\w.]+)"/g)) if (!known.has(m[1])) unknown.push(`${file}: ${m[1]}`);
      for (const m of text.matchAll(/\b(?:writeAudit|audit)\(\s*(?:tx,\s*)?"([\w.]+)"/g)) if (!known.has(m[1])) unknown.push(`${file}: ${m[1]}`);
    }
    assert.deepEqual(unknown, []);
  });

  it("jede Beschriftung gehört zu einer Aktion, jede Gruppe hat einen Titel (keine Waisen in audit.actions und audit.groups, beide Sprachen)", () => {
    const known = new Set<string>(AUDIT_ACTIONS);
    for (const [lang, tree] of [["de", de], ["en", en]] as const) {
      const { actions, groups } = (tree as unknown as { audit: { actions: Record<string, Record<string, string>>; groups: Record<string, string> } }).audit;
      const labelled = Object.entries(actions).flatMap(([group, items]) => Object.keys(items).map((key) => `${group}.${key}`));
      assert.deepEqual(labelled.filter((k) => !known.has(k)), [], `${lang}: Beschriftungen ohne Aktion`);
      assert.deepEqual(Object.keys(groups).filter((g) => !AUDIT_GROUPS.includes(g)), [], `${lang}: Gruppentitel ohne Aktionen`);
      assert.deepEqual(AUDIT_GROUPS.filter((g) => !(g in groups)), [], `${lang}: Gruppe ohne Titel`);
    }
  });
});
