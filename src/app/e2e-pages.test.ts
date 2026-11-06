import assert from "node:assert/strict";
import { afterEach, before, describe, it } from "node:test";
import { installFakes, isNotFound } from "@/test/harness";

/** Die Testseiten für absichtliche Fehlerzustände sind im Betrieb unsichtbar (404) und nur mit SCHRAUBEROS_E2E=1 wirksam. */
type Page = (props: { params: Promise<{ state: string }> }) => Promise<unknown>;
let inApp: Page;
let outside: Page;
const original = process.env.SCHRAUBEROS_E2E;

before(async () => {
  installFakes();
  inApp = ((await import("@/app/(app)/e2e-state/[state]/page")) as { default: Page }).default;
  outside = ((await import("@/app/e2e-fault/[state]/page")) as { default: Page }).default;
});
afterEach(() => {
  if (original === undefined) delete process.env.SCHRAUBEROS_E2E;
  else process.env.SCHRAUBEROS_E2E = original;
});

const props = (state: string) => ({ params: Promise.resolve({ state }) });

describe("Testseiten der Browser-CI", () => {
  it("ohne Testmodus antworten sie wie jede unbekannte Adresse (404)", async () => {
    delete process.env.SCHRAUBEROS_E2E;
    for (const state of ["error", "reinstall", "x"]) {
      assert.equal(await isNotFound(() => inApp(props(state))), true, `(app)/${state}`);
      assert.equal(await isNotFound(() => outside(props(state))), true, `fault/${state}`);
    }
    process.env.SCHRAUBEROS_E2E = "0";
    assert.equal(await isNotFound(() => outside(props("error"))), true);
  });

  it("mit Testmodus werfen sie den absichtlichen Fehler bzw. zeigen den Hinweis; unbekannte Zustände bleiben 404", async () => {
    process.env.SCHRAUBEROS_E2E = "1";
    await assert.rejects(inApp(props("error")), /absichtlicher Fehler/);
    await assert.rejects(outside(props("error")), /absichtlicher Fehler/);
    assert.ok(await outside(props("reinstall")), "Hinweis „Neuinstallation nötig“");
    assert.equal(await isNotFound(() => inApp(props("reinstall"))), true);
    assert.equal(await isNotFound(() => outside(props("gibts-nicht"))), true);
  });
});
