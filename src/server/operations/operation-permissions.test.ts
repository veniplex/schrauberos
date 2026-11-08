import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Momentaufnahme der Operationsrechte (Z6-4 H-1): `operation-permissions.txt` hält je Operation das erforderliche Recht fest (Name → Recht; bei eingabeabhängigem Recht das Ersatzrecht mit Vermerk).
 * Die Berechtigungs-Matrix (`matrix.test.ts`) baut den „falschen“ Benutzer aus der Operation selbst (alle Rechte außer dem von der Operation verlangten) und beweist deshalb nur „irgendein Recht
 * ist nötig“ – eine Änderung von `invoices.delete` auf `invoices.view` bliebe unbemerkt. Dieser Test ist die unabhängige Gegenseite: **jede Änderung eines Rechts bricht ihn**, bis die Datei bewusst
 * erneuert wird (`UPDATE_OPERATION_SNAPSHOT=1 npx tsx --test src/server/operations/operation-permissions.test.ts`) und der Unterschied im Diff sichtbar im Review steht.
 * `sensitive-permissions.test.ts` ergänzt für die sensiblen Operationen Rechte-Tests mit handgeschriebenen Erwartungen.
 */
const SRC = path.resolve(process.cwd(), "src");
const SNAPSHOT = path.join(SRC, "server", "operations", "operation-permissions.txt");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "generated" || name === "node_modules") return [];
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}
const specOf = (file: string) => `@/${path.relative(SRC, file).split(path.sep).join("/").replace(/\.tsx?$/, "")}`;

let env: TestEnv;
before(async () => {
  env = await createTestEnv();
});
after(() => env.cleanup());

describe("Operationsrechte: Momentaufnahme", () => {
  it("jede Operation und das Recht, das sie verlangt, stehen in operation-permissions.txt (Änderungen nur bewusst: UPDATE_OPERATION_SNAPSHOT=1)", async () => {
    const files = walk(SRC).filter((f) => /\bdefineOperation\b/.test(readFileSync(f, "utf8")) && !path.relative(SRC, f).split(path.sep).join("/").startsWith("server/operations/"));
    for (const file of files) await import(specOf(file));
    const { listOperations } = await import("@/server/operations");
    const lines = [...listOperations().values()]
      .map((op) => `${op.name} ${op.permission}${op.dynamicPermission ? " (nach Eingabe)" : ""}`)
      .sort((a, b) => a.localeCompare(b));
    assert.ok(lines.length > 150, `nur ${lines.length} Operationen geladen`);
    assert.equal(new Set(lines.map((l) => l.split(" ")[0])).size, lines.length, "Operationsnamen sind eindeutig");
    const text = `# Operationsname → erforderliches Recht (erzeugt aus der Registry; erneuern: UPDATE_OPERATION_SNAPSHOT=1 npx tsx --test src/server/operations/operation-permissions.test.ts)\n${lines.join("\n")}\n`;
    if (process.env.UPDATE_OPERATION_SNAPSHOT === "1") {
      writeFileSync(SNAPSHOT, text);
      return;
    }
    assert.ok(existsSync(SNAPSHOT), "operation-permissions.txt fehlt (UPDATE_OPERATION_SNAPSHOT=1)");
    const expected = readFileSync(SNAPSHOT, "utf8").replace(/\r\n/g, "\n");
    if (expected !== text) {
      const have = new Set(expected.split("\n"));
      const now = new Set(text.split("\n"));
      const changed = [...now].filter((l) => !have.has(l)).map((l) => `+ ${l}`).concat([...have].filter((l) => !now.has(l)).map((l) => `- ${l}`));
      assert.fail(`Die Rechte der Operationen haben sich geändert (bewusst? dann UPDATE_OPERATION_SNAPSHOT=1):\n${changed.join("\n")}`);
    }
  });
});
