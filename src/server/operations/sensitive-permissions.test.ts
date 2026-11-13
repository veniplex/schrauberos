import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { ALL_PERMISSIONS, FEATURES } from "@/modules/catalog";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Unabhängige Rechte-Tests für die sensiblen Operationen (Z6-4 H-1). Die Erwartung steht **von Hand** in dieser Datei – nicht aus der Operation abgeleitet:
 *  - die Operation verlangt genau dieses Recht (`listOperations`),
 *  - ein Benutzer mit **allen anderen Rechten derselben Gruppe** (etwa `invoices.view`, `invoices.edit` … ohne `invoices.delete`) wird abgewiesen – das fängt die Verwechslung mit einem Nachbarrecht,
 *    die die generierte Matrix (alle Rechte außer dem verlangten) nicht erkennt,
 *  - ein Benutzer mit genau diesem einen Recht wird nicht am Recht abgewiesen.
 * Mutationsprobe (13e, auf einer Kopie im Scratchpad): `invoices.delete` → `invoices.view`, `vault.delete` → `docs.vault`, `customers.delete` → `customers.view` usw. werden von diesem Test erkannt.
 */
const SENSITIVE: Record<string, string> = {
  "vault.delete": "docs.vaultManage",
  "vault.reveal": "docs.vault",
  "vault.save": "docs.vaultManage",
  "customers.delete": "customers.delete",
  "invoices.cancel": "invoices.edit",
  "invoices.delete": "invoices.delete",
  "invoices.markPaid": "invoices.edit",
  "invoices.finalize": "invoices.finalize",
  "time.void": "time.correct",
  "checklists.start": "checklists.fill",
  "checklists.discard": "checklists.fill",
  "checklists.reopen": "checklists.reopen",
  "orders.reopen": "orders.reopen",
  "admin.users.unlock": "users.manage",
  "admin.users.resetTwoFactor": "users.manage",
  "admin.users.delete": "users.manage",
  "admin.backup.restore": "backup.manage",
  "admin.roles.save": "roles.manage",
  "admin.roles.delete": "roles.manage",
  "employees.delete": "employees.delete",
  "fleet.delete": "fleet.delete",
  "vehicles.delete": "vehicles.delete",
};

const SRC = path.resolve(process.cwd(), "src");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "generated" || name === "node_modules") return [];
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}
const specOf = (file: string) => `@/${path.relative(SRC, file).split(path.sep).join("/").replace(/\.tsx?$/, "")}`;

let env: TestEnv;
let operations: ReadonlyMap<string, import("@/server/operations").Operation>;
let sessionModule: typeof import("@/server/auth/session");
let seq = 0;

before(async () => {
  env = await createTestEnv();
  for (const f of FEATURES) {
    if ((f as { defaultEnabled?: boolean }).defaultEnabled !== false || ("required" in f && f.required)) continue;
    const key = `${f.module}.${f.id}`;
    await env.db.featureSetting.upsert({ where: { key }, update: { enabled: true }, create: { key, enabled: true, updatedByName: "test" } });
  }
  const files = walk(SRC).filter((f) => /\bdefineOperation\b/.test(readFileSync(f, "utf8")) && !path.relative(SRC, f).split(path.sep).join("/").startsWith("server/operations/"));
  for (const file of files) await import(specOf(file));
  operations = (await import("@/server/operations")).listOperations();
  sessionModule = await import("@/server/auth/session");
});
after(() => env.cleanup());

async function principalWith(permissions: readonly string[]) {
  const role = await env.role({ key: `sens-${++seq}`, permissions });
  env.signOut();
  await env.signIn(await env.user({ username: `sens-${seq}`, roles: [role] }));
  const session = await sessionModule.getSession();
  assert.ok(session, "angemeldet");
  return session;
}

describe("Sensible Operationen: das Recht ist das richtige, nicht ein Nachbarrecht", () => {
  it("jede Operation der Liste gibt es und verlangt genau das erwartete Recht", () => {
    for (const [name, required] of Object.entries(SENSITIVE)) {
      const op = operations.get(name);
      assert.ok(op, `${name}: Operation gibt es nicht (mehr) – Tabelle anpassen`);
      assert.equal(op.permission, required, `${name}: verlangt ${op.permission}, erwartet ${required}`);
      assert.ok(ALL_PERMISSIONS.includes(required as never), `${required}: kein Recht des Katalogs`);
    }
  });

  for (const [name, required] of Object.entries(SENSITIVE)) {
    it(`${name}: mit allen anderen Rechten der Gruppe „${required.split(".")[0]}“ (aber ohne ${required}) abgewiesen, mit genau ${required} nicht am Recht`, async () => {
      const op = operations.get(name)!;
      const group = required.split(".")[0]!;
      const neighbours = ALL_PERMISSIONS.filter((p) => p.startsWith(`${group}.`) && p !== required);
      // Gruppen mit nur einem Recht: stattdessen alle Rechte außer dem verlangten
      const without = neighbours.length > 0 ? neighbours : ALL_PERMISSIONS.filter((p) => p !== required);
      const denied = await op.execute(await principalWith(without), {});
      assert.equal(denied.ok, false, `${name}: ohne ${required} nicht ausgeführt`);
      assert.equal(!denied.ok && denied.failure.code, "forbidden", `${name}: Nachbarrechte (${neighbours.join(", ") || "alle anderen"}) reichen nicht`);

      const allowed = await op.execute(await principalWith([required]), {});
      assert.ok(allowed.ok || allowed.failure.code !== "forbidden", `${name}: mit ${required} fälschlich am Recht abgewiesen`);
    });
  }
});

