import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { setDiskSpaceForTest } from "@/lib/disk";
import { makeToken } from "@/test/api-helpers";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Platzschutz und Upload-Drossel (Z6-2 M2): Uploads stoppen deutlich vor SQLite (Reserve max(256 MiB, 5 %)), alle Upload-Wege teilen sich eine Stundendrossel je Konto,
 * und bei fast vollem Datenträger bleibt die Anmeldung möglich (Sitzung und Audit schreiben weiter).
 */
let env: TestEnv;
let files: typeof import("./files");
let budget: typeof import("./upload-budget");
const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

before(async () => {
  env = await createTestEnv();
  files = await import("./files");
  budget = await import("./upload-budget");
});
after(() => env.cleanup());
beforeEach(() => budget.resetUploadBudget());
afterEach(() => setDiskSpaceForTest(null));

const space = (freeBytes: number, totalBytes = 100 * GiB) => setDiskSpaceForTest(async () => ({ freeBytes, totalBytes }));
const bytes = (n: number) => new Uint8Array(n).fill(1);

describe("storeFile: freier Platz", () => {
  it("lässt die Reserve frei: max(256 MiB, 5 % des Datenträgers) nach dem Ablegen", async () => {
    // 100 GiB: 5 % = 5 GiB > 256 MiB
    space(5 * GiB + 10, 100 * GiB);
    await assert.rejects(() => files.storeFile("platz", "zu-viel.bin", bytes(100)), (error: { failure?: { code: string } }) => error.failure?.code === "storageFull");
    space(5 * GiB + 100, 100 * GiB);
    const rel = await files.storeFile("platz", "passt.bin", bytes(100));
    assert.match(rel, /^platz\/passt\.bin$/);
    // kleiner Datenträger: die feste Untergrenze 256 MiB gilt (1 GiB * 5 % = 51 MiB)
    space(256 * MiB + 99, 1 * GiB);
    await assert.rejects(() => files.storeFile("platz", "klein.bin", bytes(100)), (error: { failure?: { code: string } }) => error.failure?.code === "storageFull");
    space(256 * MiB + 100, 1 * GiB);
    await files.storeFile("platz", "klein-ok.bin", bytes(100));
  });

  it("meldet das Dateisystem nichts, wird nichts abgewiesen; abgewiesene Uploads hinterlassen keine Zwischendatei", async () => {
    setDiskSpaceForTest(async () => null);
    await files.storeFile("platz", "unbekannt.bin", bytes(10));
    space(0);
    const tmpBefore = await import("node:fs/promises").then((fs) => fs.readdir(path.join(files.filesDir(), ".tmp")).catch(() => []));
    await assert.rejects(() => files.storeFile("platz", "voll.bin", bytes(10)));
    const tmpAfter = await import("node:fs/promises").then((fs) => fs.readdir(path.join(files.filesDir(), ".tmp")).catch(() => []));
    assert.deepEqual(tmpAfter, tmpBefore);
    rmSync(path.join(files.filesDir(), "platz"), { recursive: true, force: true });
  });

  it("ENOSPC mitten im Schreiben (Platte voll trotz Reserve): storageFull, keine halbe Zwischendatei", async () => {
    const fsp = (await import("node:fs/promises")).default;
    const real = fsp.writeFile;
    const tmpDir = path.join(files.filesDir(), ".tmp");
    const before = (await fsp.readdir(tmpDir).catch(() => [])).length;
    fsp.writeFile = (async (target: string, ...rest: unknown[]) => {
      await real(target as never, Buffer.from("halb"), { flag: "wx" }); // ein Teil kam noch an
      void rest;
      throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
    }) as never;
    try {
      await assert.rejects(() => files.storeFile("platz", "enospc.bin", bytes(10)), (error: { failure?: { code: string } }) => error.failure?.code === "storageFull");
    } finally {
      fsp.writeFile = real;
    }
    assert.equal((await fsp.readdir(tmpDir).catch(() => [])).length, before, "die halbe Zwischendatei wurde entfernt");
    await assert.doesNotReject(() => files.storeFile("platz", "danach.bin", bytes(10)));
  });

  it("storageFull wird zur Meldung der Oberfläche und zu HTTP 507 der API", async () => {
    const { failureToProblem } = await import("@/server/operations/api");
    const { DEFAULT_KEYS } = await import("@/server/operations/errors");
    assert.equal(DEFAULT_KEYS.storageFull, "common.errors.storageFull");
    const problem = failureToProblem({ code: "storageFull" }, {});
    assert.equal(problem.status, 507);
    assert.equal(problem.code, "storage_full");
  });

  it("die Anmeldung geht mit fast vollem Datenträger weiter (Sitzung und Audit schreiben in die Datenbank, die Reserve bleibt frei)", async () => {
    space(1 * MiB);
    const user = await env.user({ username: "voll", password: "voll-passwort-123" });
    const session = await import("./auth/session");
    const result = await session.login("voll", "voll-passwort-123", { ip: null });
    assert.equal(result.ok, true);
    assert.equal(await env.db.session.count({ where: { userId: user.id } }), 1);
  });
});

describe("gemeinsame Upload-Drossel", () => {
  it("200 Uploads und 500 MB je Konto und Stunde über alle Wege; ein anderes Konto hat sein eigenes Budget", () => {
    for (let i = 0; i < budget.UPLOADS_PER_HOUR; i++) assert.equal(budget.takeUploadBudget("anna", 1).allowed, true, String(i));
    const denied = budget.takeUploadBudget("anna", 1);
    assert.equal(denied.allowed, false);
    assert.equal(budget.takeUploadBudget("berta", 1).allowed, true);
    budget.resetUploadBudget();
    assert.equal(budget.takeUploadBudget("anna", 400 * MiB).allowed, true);
    assert.equal(budget.takeUploadBudget("anna", 200 * MiB).allowed, false, "Bytebudget");
    const again = budget.takeUploadBudget("anna", 200 * MiB);
    assert.equal(again.allowed, false);
    if (!again.allowed) assert.ok(budget.retryAfterSeconds(again) >= 1);
  });

  it("Datei-Uploads der Programmierschnittstelle zählen mit: ein Token-Besitzer, der sein Stundenbudget verbraucht hat, bekommt 429", async () => {
    const router = await import("@/server/api/router");
    const state = await import("@/server/api/state");
    state.apiLimits.failuresGlobal = 1_000_000;
    await env.db.featureSetting.upsert({ where: { key: "workshop.files" }, update: { enabled: true }, create: { key: "workshop.files", enabled: true, updatedByName: "test" } });
    const { token } = await makeToken(env, { ownerPermissions: ["files.view", "files.upload", "vehicles.view"], scope: ["files.view", "files.upload", "vehicles.view"], rateLimitPerMinute: 6000 });
    const owner = await env.db.user.findFirstOrThrow({ where: { apiTokens: { some: {} } } });
    for (let i = 0; i < budget.UPLOADS_PER_HOUR; i++) budget.takeUploadBudget(owner.id, 1);
    const form = new FormData();
    form.set("ownerType", "vehicle");
    form.set("ownerId", "x");
    form.set("file", new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" }));
    const response = await router.handleApiRequest(new Request("http://localhost/api/v1/files", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form }));
    assert.equal(response.status, 429);
    assert.ok(Number(response.headers.get("retry-after")) >= 1);
  });
});

