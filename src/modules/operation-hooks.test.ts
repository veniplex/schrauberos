import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import type { OperationHookDef } from "@/server/operations/hooks";
import { FEATURES } from "./catalog";
import { featureKey } from "./catalog-logic";
import { operationHooks } from "./operation-hooks";

/**
 * Transaktionale Hooks (ZP2-A-F3): Ein Hook nennt die Operation einer anderen Funktion als Zeichenkette – an der Modulgrenze vorbei. Zwei Regeln halten das zusammen:
 *  1. Die Operation gibt es (ein Tippfehler ließe den Hook für immer stumm bleiben),
 *  2. die Funktion des Hooks deklariert die Funktion der Operation als `requires`/`uses` (sonst koppelt sie ungeprüft an eine Funktion, die sie nicht kennen dürfte –
 *     dieselbe Regel wie für Importe in `architecture.test.ts`).
 * Es gibt noch keinen echten Hook; die Prüfung ist als Funktion geschrieben und wird auch an erfundenen Hooks getestet, damit sie beim ersten echten nicht ins Leere läuft.
 */
const SRC = path.resolve(process.cwd(), "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "generated" || name === "node_modules") return [];
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

/** Operationsname → Funktion (`<modul>.<funktion>`) bzw. null (Plattform: Konto, Verwaltung außerhalb von Funktionsordnern …). */
function operationOwners(): Map<string, string | null> {
  const owners = new Map<string, string | null>();
  for (const file of walk(SRC)) {
    const source = readFileSync(file, "utf8");
    if (!source.includes("defineOperation")) continue;
    const rel = path.relative(SRC, file).split(path.sep).join("/");
    const owner = /^modules\/([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)\//.exec(rel);
    for (const m of source.matchAll(/defineOperation\s*(?:<[^(]*>)?\s*\(\{[\s\S]*?\bname:\s*"([^"]+)"/g)) owners.set(m[1], owner ? `${owner[1]}.${owner[2]}` : null);
  }
  return owners;
}

/** Deklarierte Abhängigkeiten (`requires` und `uses`) einer Funktion. */
const declared = (def: object): Set<string> => new Set<string>([...(("requires" in def ? (def.requires as string[]) : []) ?? []), ...(("uses" in def ? (def.uses as string[]) : []) ?? [])]);

export function hookViolations(hooks: readonly Pick<OperationHookDef, "operation" | "feature">[], owners: ReadonlyMap<string, string | null>): string[] {
  const problems: string[] = [];
  for (const hook of hooks) {
    const label = `${hook.feature} → ${hook.operation}`;
    if (!owners.has(hook.operation)) {
      problems.push(`${label}: die Operation gibt es nicht`);
      continue;
    }
    const def = FEATURES.find((f) => featureKey(f) === hook.feature);
    if (!def) {
      problems.push(`${label}: die Funktion des Hooks gibt es nicht`);
      continue;
    }
    const owner = owners.get(hook.operation);
    if (owner && owner !== hook.feature) {
      if (!declared(def).has(owner)) problems.push(`${label}: ${hook.feature} deklariert ${owner} nicht als requires/uses`);
    }
  }
  return problems;
}

describe("Operations-Hooks", () => {
  const owners = operationOwners();

  it("findet die Operationen (kein leerer Lauf)", () => {
    assert.ok(owners.size > 50, `nur ${owners.size} Operationen gefunden`);
    assert.equal(owners.get("invoices.markPaid"), "office.invoices");
    assert.equal(owners.get("account.changePassword"), null, "Konto ist Plattform");
  });

  it("jeder eingetragene Hook nennt eine vorhandene Operation und deklariert die Funktion dieser Operation (requires/uses)", () => {
    assert.deepEqual(hookViolations(operationHooks, owners), []);
  });

  it("jeder Hook auf customers.anonymize läuft auch bei ausgeschalteter Funktion (always): deren Daten bleiben in der Datenbank", () => {
    const missing = operationHooks.filter((h) => h.operation === "customers.anonymize" && !h.always).map((h) => h.feature);
    assert.deepEqual(missing, []);
    assert.ok(operationHooks.filter((h) => h.operation === "customers.anonymize").length >= 6);
  });

  it("die Prüfung erkennt Tippfehler, unbekannte Funktionen und fehlende Deklarationen – und lässt Richtiges durch", () => {
    // office.fleet deklariert office.invoices nicht (und umgekehrt) – prüfen, was der Katalog tatsächlich sagt
    const fleet = FEATURES.find((f) => featureKey(f) === "office.fleet")!;
    const declaresInvoices = declared(fleet).has("office.invoices");
    assert.equal(declaresInvoices, false, "Annahme des Tests: Fuhrpark kennt das Rechnungsarchiv nicht");
    const problems = hookViolations(
      [
        { operation: "invoices.markPaidd", feature: "office.fleet" },
        { operation: "invoices.markPaid", feature: "office.fleet" },
        { operation: "invoices.markPaid", feature: "gibt.es.nicht" as never },
        { operation: "invoices.markPaid", feature: "office.invoices" },
      ],
      owners,
    );
    assert.equal(problems.length, 3, problems.join("\n"));
    assert.match(problems[0], /die Operation gibt es nicht/);
    assert.match(problems[1], /deklariert office\.invoices nicht/);
    assert.match(problems[2], /die Funktion des Hooks gibt es nicht/);
  });
});
