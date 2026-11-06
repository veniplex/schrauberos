import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import * as tar from "tar";
import { startupState } from "@/server/startup-state";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Datei-Handler: Rechnungsbeleg (Auslieferung), Sicherungen (Download und Upload). Rechte, Kopfzeilen gegen Sniffing/Zwischenspeicher,
 * Pfad-Tricks, Fremdaufrufe (Herkunft, eigener Header) und Audit – jeweils mit echten Dateien und Archiven.
 */
let env: TestEnv;
let invoiceRoute: typeof import("./invoices/[id]/file/route");
let uploadRoute: typeof import("./backups/upload/route");
let downloadRoute: typeof import("./backups/[name]/route");
let storeFile: typeof import("@/server/files").storeFile;
let core: typeof import("@/server/backup/core");

before(async () => {
  env = await createTestEnv();
  invoiceRoute = await import("./invoices/[id]/file/route");
  uploadRoute = await import("./backups/upload/route");
  downloadRoute = await import("./backups/[name]/route");
  ({ storeFile } = await import("@/server/files"));
  core = await import("@/server/backup/core");
});
after(() => env.cleanup());

let n = 0;
async function signInWith(permissions: string[], extra: { mustChangePassword?: boolean } = {}) {
  env.signOut();
  await env.signIn(await env.user({ username: `f-${++n}`, mustChangePassword: extra.mustChangePassword, roles: [await env.role({ key: `f-${n}`, permissions })] }));
}

beforeEach(async () => {
  await env.db.auditLog.deleteMany();
  env.signOut();
});

/* ───────────── Rechnungsbeleg ───────────── */

describe("Rechnungsbeleg ausliefern", () => {
  let invoiceId: string;
  const get = (id = invoiceId, query = "") => invoiceRoute.GET(new NextRequest(`http://localhost/api/invoices/${id}/file${query}`), { params: Promise.resolve({ id }) });

  beforeEach(async () => {
    await env.db.invoice.deleteMany();
    const rel = await storeFile("rechnungen/2026/eingang", "2026-03-14_Müller & Söhne_RE-1.pdf", new TextEncoder().encode("%PDF-1.4 beleg"));
    const invoice = await env.db.invoice.create({ data: { direction: "incoming", number: "RE-1", partyName: "Müller", issueDate: new Date(), grossCents: 100 } });
    await env.db.invoiceFile.create({ data: { invoiceId: invoice.id, name: 'Beleg "Ä".pdf', mime: "application/pdf", size: 14, path: rel } });
    invoiceId = invoice.id;
  });

  it("ohne Anmeldung 401, mit offenem Passwortwechsel 401, ohne invoices.view 403 – es fließt nichts", async () => {
    assert.equal((await get()).status, 401);
    await signInWith(["invoices.view"], { mustChangePassword: true });
    assert.equal((await get()).status, 401);
    await signInWith(["invoices.edit", "customers.view"]);
    const denied = await get();
    assert.equal(denied.status, 403);
    assert.equal((await denied.text()).includes("PDF"), false);
  });

  it("liefert den Beleg inline mit Typ, Länge und Schutzkopfzeilen aus", async () => {
    await signInWith(["invoices.view"]);
    const res = await get();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.equal(res.headers.get("content-length"), "14");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    assert.match(res.headers.get("content-disposition") ?? "", /^inline;/);
    assert.equal(await res.text(), "%PDF-1.4 beleg");
  });

  it("?download=1 erzwingt den Download; der Dateiname ist ASCII-sicher und in UTF-8 kodiert (kein Header-Einschleusen)", async () => {
    await signInWith(["invoices.view"]);
    const header = (await get(invoiceId, "?download=1")).headers.get("content-disposition") ?? "";
    assert.match(header, /^attachment;/);
    assert.equal(/filename="([^"]*)"/.exec(header)?.[1], "Beleg ___.pdf", "Anführungszeichen und Nicht-ASCII-Zeichen werden ersetzt");
    assert.ok(header.includes("filename*=UTF-8''"));
    assert.equal(header.includes("\n"), false);
  });

  it("unbekannte Rechnung, Rechnung ohne Beleg oder fehlende Datei: 404", async () => {
    await signInWith(["invoices.view"]);
    assert.equal((await get("gibt-es-nicht")).status, 404);
    const bare = await env.db.invoice.create({ data: { direction: "incoming", number: "RE-2", partyName: "Y", issueDate: new Date(), grossCents: 1 } });
    assert.equal((await get(bare.id)).status, 404);
    const file = await env.db.invoiceFile.findUniqueOrThrow({ where: { invoiceId } });
    await env.db.invoiceFile.update({ where: { id: file.id }, data: { path: "rechnungen/gibt-es-nicht.pdf" } });
    assert.equal((await get()).status, 404);
  });
});

/* ───────────── Sicherungen ───────────── */

describe("Sicherung herunterladen", () => {
  let name: string;
  const get = (value = name) => downloadRoute.GET(new Request(`http://localhost/api/backups/${value}`), { params: Promise.resolve({ name: value }) });

  before(async () => {
    name = (await core.createBackup("manual")).name;
  });

  it("nur mit backup.manage (401/403), ohne Datei-Lieferung im Fehlerfall", async () => {
    assert.equal((await get()).status, 401);
    await signInWith(["backup.manage"], { mustChangePassword: true });
    assert.equal((await get()).status, 401);
    await signInWith(["users.manage", "settings.manage"]);
    const denied = await get();
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get("content-type")?.includes("tar"), false);
    assert.equal(await env.db.auditLog.count({ where: { action: "backup.download" } }), 0);
  });

  it("liefert ein .tar mit der Sicherung, setzt no-store und protokolliert den Download", async () => {
    await signInWith(["backup.manage"]);
    const res = await get();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/x-tar");
    assert.equal(res.headers.get("content-disposition"), `attachment; filename="${name}.tar"`);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.ok(bytes.length > 512);
    const entries: string[] = [];
    const parser = new tar.Parser();
    parser.on("entry", (entry) => {
      entries.push(entry.path);
      entry.resume();
    });
    await new Promise<void>((resolve, reject) => {
      parser.on("end", resolve);
      parser.on("error", reject);
      parser.end(bytes);
    });
    assert.ok(entries.some((e) => e.endsWith(core.DB_ARCHIVE)), "enthält die Datenbank");
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "backup.download" } });
    assert.equal(entry.target, name);
  });

  it("Pfad-Tricks und unbekannte Namen: 404, kein Zugriff außerhalb der Sicherungen", async () => {
    await signInWith(["backup.manage"]);
    for (const bad of ["..", "../files", "%2e%2e", "schrauberos-x/../../secret.key", "irgendwas", "schrauberos-20260101T020000Z-manual", `${name}/..`]) {
      assert.equal((await get(bad)).status, 404, bad);
    }
    assert.equal(await env.db.auditLog.count({ where: { action: "backup.download" } }), 0);
  });
});

describe("Sicherung hochladen", () => {
  const post = (body: Buffer | null, headers: Record<string, string> = { "x-requested-with": "schrauberos", host: "localhost" }) =>
    uploadRoute.POST(new NextRequest("http://localhost/api/backups/upload", { method: "POST", headers, body: body ? new Uint8Array(body) : null, ...(body ? ({ duplex: "half" } as object) : {}) }));
  let archive: Buffer;

  before(async () => {
    const info = await core.createBackup("manual");
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const pack = tar.c({ cwd: core.backupPath(info.name)!, portable: true }, ["."]);
      pack.on("data", (c: Buffer) => chunks.push(c));
      pack.on("end", resolve);
      pack.on("error", reject);
    });
    archive = Buffer.concat(chunks);
  });

  const uploads = () => readdirSync(core.backupsDir()).filter((f) => f.startsWith(".upload-"));

  it("ohne Anmeldung 401, mit Passwortwechsel 401, ohne backup.manage 403 – es wird nichts angelegt", async () => {
    const before = core.listBackups().length;
    assert.equal((await post(archive)).status, 401);
    await signInWith(["backup.manage"], { mustChangePassword: true });
    assert.equal((await post(archive)).status, 401);
    await signInWith(["settings.manage"]);
    assert.equal((await post(archive)).status, 403);
    assert.equal(core.listBackups().length, before);
  });

  it("Fremdaufrufe werden abgewiesen: ohne eigenen Header oder mit fremder Herkunft", async () => {
    await signInWith(["backup.manage"]);
    const before = core.listBackups().length;
    assert.equal((await post(archive, { host: "localhost" })).status, 403, "ohne X-Requested-With");
    assert.equal((await post(archive, { "x-requested-with": "irgendwas", host: "localhost" })).status, 403);
    assert.equal((await post(archive, { "x-requested-with": "schrauberos", host: "localhost", origin: "https://evil.example" })).status, 403, "fremde Herkunft");
    assert.equal(core.listBackups().length, before);
    assert.equal((await post(archive, { "x-requested-with": "schrauberos", host: "localhost", origin: "http://localhost" })).status, 200, "gleiche Herkunft ist in Ordnung");
  });

  it("legt eine gültige Sicherung als „upload“ an, räumt die Zwischendatei weg und protokolliert", async () => {
    await signInWith(["backup.manage"]);
    const res = await post(archive);
    assert.equal(res.status, 200);
    const { name } = (await res.json()) as { name: string };
    assert.match(name, /-upload$/);
    assert.ok(core.listBackups().some((b) => b.name === name));
    assert.deepEqual(uploads(), []);
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "backup.upload" } });
    assert.equal(entry.target, name);
  });

  it("Zustand „Neuinstallation nötig“: 503, auch mit Sitzung – die Route läuft nicht durch den Proxy und beantwortet das selbst, es wird nichts angelegt", async () => {
    await signInWith(["backup.manage"]);
    const state = startupState();
    const before = state.status;
    const count = core.listBackups().length;
    state.status = "reinstall";
    try {
      const res = await post(archive);
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { status: "reinstall" });
    } finally {
      state.status = before;
    }
    assert.equal(core.listBackups().length, count);
    assert.deepEqual(uploads(), []);
  });

  it("eine Sicherung über 10 MiB (Puffergrenze des Proxys) kommt vollständig an und wird angelegt (ZP2-A-F1)", async () => {
    await signInWith(["backup.manage"]);
    const info = await core.createBackup("manual");
    const dir = core.backupPath(info.name)!;
    mkdirSync(path.join(dir, "files", "gross"), { recursive: true });
    const big = path.join(dir, "files", "gross", "beleg.bin");
    writeFileSync(big, randomBytes(11 * 1024 * 1024));
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const pack = tar.c({ cwd: dir, portable: true }, ["."]);
      pack.on("data", (c: Buffer) => chunks.push(c));
      pack.on("end", resolve);
      pack.on("error", reject);
    });
    const large = Buffer.concat(chunks);
    assert.ok(large.length > 11 * 1024 * 1024);
    const res = await post(large);
    assert.equal(res.status, 200, await res.clone().text());
    const { name } = (await res.json()) as { name: string };
    assert.equal(statSync(path.join(core.backupPath(name)!, "files", "gross", "beleg.bin")).size, 11 * 1024 * 1024, "die Datei ist nicht abgeschnitten");
  });

  it("Müll, leerer Body und fremde Datenbanken: abgelehnt (422/400), Zwischendatei weg, Fehlschlag im Audit – nur mit Fehlercode", async () => {
    await signInWith(["backup.manage"]);
    const before = core.listBackups().length;
    const junk = await post(Buffer.from("das ist kein Backup, nur Müll mit Geheimnis hunter2"));
    assert.equal(junk.status, 422);
    const body = (await junk.json()) as { error: string };
    assert.ok(["notBackup", "corrupt"].includes(body.error));
    assert.equal((await post(null)).status, 400);
    assert.equal(core.listBackups().length, before);
    assert.deepEqual(uploads(), []);
    const failures = await env.db.auditLog.findMany({ where: { action: "backup.uploadFailed" } });
    assert.ok(failures.length >= 1);
    assert.equal(JSON.stringify(failures).includes("hunter2"), false, "kein Dateiinhalt im Audit-Log");
    assert.equal(existsSync(path.join(core.backupsDir(), ".upload-")), false);
  });
});
