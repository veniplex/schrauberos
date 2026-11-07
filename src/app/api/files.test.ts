import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import * as tar from "tar";
import { DISK_RESERVE_BYTES, setFreeBytesForTest } from "@/lib/disk";
import { startupState } from "@/server/startup-state";
import { rawTar, type RawEntry } from "@/test/tar";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Datei-Handler: Rechnungsbeleg (Auslieferung), Sicherungen (Download und Upload). Rechte, Kopfzeilen gegen Sniffing/Zwischenspeicher,
 * Pfad-Tricks, Fremdaufrufe (Herkunft, eigener Header) und Audit – jeweils mit echten Dateien und Archiven.
 */
let env: TestEnv;
let invoiceRoute: typeof import("./invoices/[id]/file/route");
let uploadRoute: typeof import("./backups/upload/route");
let downloadRoute: typeof import("./backups/[name]/route");
let imageRoute: typeof import("./docs/images/route");
let storeFile: typeof import("@/server/files").storeFile;
let core: typeof import("@/server/backup/core");

before(async () => {
  env = await createTestEnv();
  startupState().status = "ready"; // frisch gestartet ist der Zustand „starting“ (die Upload-Route sperrt dann)
  invoiceRoute = await import("./invoices/[id]/file/route");
  uploadRoute = await import("./backups/upload/route");
  downloadRoute = await import("./backups/[name]/route");
  imageRoute = await import("./docs/images/route");
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

/* ───────────── Doku-Bilder hochladen ───────────── */

describe("Doku-Bild hochladen (ZP2-A-F12: wird protokolliert; SEC-12: Inhalt, Herkunft, Größe)", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const HEADERS = { "x-requested-with": "schrauberos", host: "localhost" };
  const upload = async (area: string, file: File | null, headers: Record<string, string> = HEADERS) => {
    const body = new FormData();
    body.set("area", area);
    if (file) body.set("file", file);
    // Ein Browser sendet die Länge des Bodys mit (Pflicht, ZP3-S-F6); in diesem Test genügt eine passende Näherung
    return imageRoute.POST(new NextRequest("http://localhost/api/docs/images", { method: "POST", body, headers: { "content-length": String((file?.size ?? 0) + 1024), ...headers } }));
  };

  it("legt das Bild ab, antwortet mit Adresse und schreibt einen Audit-Eintrag (Bereich, Dateiname); Fehlschläge schreiben nichts", async () => {
    const { DOC_PERMISSIONS, DOC_AREAS } = await import("@/capabilities/docs/areas");
    const area = DOC_AREAS[0];
    assert.equal((await upload(area, new File([PNG], "a.png", { type: "image/png" }))).status, 401);
    await signInWith([]);
    assert.equal((await upload(area, new File([PNG], "a.png", { type: "image/png" }))).status, 403);
    await signInWith([DOC_PERMISSIONS[area].edit]);
    assert.equal((await upload(area, new File([PNG], "a.txt", { type: "text/plain" }))).status, 415);
    assert.equal((await upload(area, new File([new Uint8Array(0)], "leer.png", { type: "image/png" }))).status, 413);
    assert.equal(await env.db.auditLog.count({ where: { action: "docs.imageUpload" } }), 0);

    const res = await upload(area, new File([PNG], "Schaltplan.png", { type: "image/png" }));
    assert.equal(res.status, 200);
    const { id, url } = (await res.json()) as { id: string; url: string };
    assert.equal(url, `/api/docs/images/${id}`);
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "docs.imageUpload" } });
    assert.equal(entry.entityId, id);
    assert.equal(entry.target, `${area}: Schaltplan.png`);
  });

  it("ohne Content-Length 411, und wer in keinem Bereich bearbeiten darf, bekommt 403, bevor der Body gelesen wird (ZP3-S-F6)", async () => {
    const { DOC_PERMISSIONS, DOC_AREAS } = await import("@/capabilities/docs/areas");
    const area = DOC_AREAS[0];
    // Der Body wird bei einem Verstoß nie gelesen: ein Strom, der beim Lesen wirft, zeigt es
    let read = false;
    const poisoned = () =>
      new ReadableStream(
        {
          pull() {
            read = true;
            throw new Error("Body gelesen");
          },
        },
        { highWaterMark: 0 }, // nichts vorab lesen: pull() läuft nur, wenn jemand den Body liest
      );
    const post = (headers: Record<string, string>) =>
      imageRoute.POST(new NextRequest("http://localhost/api/docs/images", { method: "POST", body: poisoned(), headers, duplex: "half" } as ConstructorParameters<typeof NextRequest>[1]));

    await signInWith([]);
    assert.equal((await post({ ...HEADERS, "content-length": "100" })).status, 403, "kein Bearbeiten-Recht in irgendeinem Bereich");
    assert.equal((await post({ ...HEADERS })).status, 403, "Recht vor Längenprüfung");
    await signInWith([DOC_PERMISSIONS[area].edit]);
    assert.equal((await post({ ...HEADERS })).status, 411, "ohne Content-Length (z. B. chunked) gibt es keine Grenze");
    assert.equal((await post({ ...HEADERS, "content-length": "abc" })).status, 411);
    assert.equal((await post({ ...HEADERS, "content-length": "-5" })).status, 411);
    assert.equal(read, false, "der Body wurde nie gelesen");
  });

  it("HTML als .png (mit Typ image/png), ein Bild unter falschem Typ und Text werden abgelehnt (415) – es wird nichts gespeichert", async () => {
    const { DOC_PERMISSIONS, DOC_AREAS } = await import("@/capabilities/docs/areas");
    const area = DOC_AREAS[0];
    await signInWith([DOC_PERMISSIONS[area].edit]);
    const before = await env.db.docImage.count();
    const html = new TextEncoder().encode("<html><script>fetch('/api/backups/x')</script></html>");
    for (const file of [
      new File([html], "bild.png", { type: "image/png" }),
      new File([html], "bild.jpg", { type: "image/jpeg" }),
      new File([html], "bild.gif", { type: "" }),
      new File([PNG], "bild.jpg", { type: "image/jpeg" }),
      new File([new TextEncoder().encode("%PDF-1.4")], "bild.png", { type: "image/png" }),
    ]) {
      assert.equal((await upload(area, file)).status, 415, `${file.name} (${file.type})`);
    }
    assert.equal(await env.db.docImage.count(), before);
    assert.equal(await env.db.auditLog.count({ where: { action: "docs.imageUpload" } }), 0);
  });

  it("speichert den erkannten Typ und passende Endung, nicht die Angaben des Absenders", async () => {
    const { DOC_PERMISSIONS, DOC_AREAS } = await import("@/capabilities/docs/areas");
    const area = DOC_AREAS[0];
    await signInWith([DOC_PERMISSIONS[area].edit]);
    const res = await upload(area, new File([PNG], "Foto.exe", { type: "" }));
    assert.equal(res.status, 200);
    const { id } = (await res.json()) as { id: string };
    const row = await env.db.docImage.findUniqueOrThrow({ where: { id } });
    assert.equal(row.mime, "image/png");
    assert.ok(row.path.endsWith(".png"), row.path);
  });

  it("Fremdaufrufe: ohne eigenen Header, mit fremder Herkunft oder fremder Website (Sec-Fetch-Site) 403; zu große Anfragen werden gar nicht gelesen (413)", async () => {
    const { DOC_PERMISSIONS, DOC_AREAS, DOC_IMAGE_MAX_BYTES } = await import("@/capabilities/docs/areas");
    const area = DOC_AREAS[0];
    await signInWith([DOC_PERMISSIONS[area].edit]);
    const file = new File([PNG], "a.png", { type: "image/png" });
    const before = await env.db.docImage.count();
    assert.equal((await upload(area, file, { host: "localhost" })).status, 403, "ohne X-Requested-With");
    assert.equal((await upload(area, file, { ...HEADERS, origin: "https://evil.example" })).status, 403, "fremde Herkunft");
    assert.equal((await upload(area, file, { ...HEADERS, origin: "null" })).status, 403, "Origin: null");
    assert.equal((await upload(area, file, { ...HEADERS, "sec-fetch-site": "cross-site" })).status, 403, "fremde Website");
    assert.equal((await upload(area, file, { ...HEADERS, "sec-fetch-site": "same-site" })).status, 403, "andere Subdomain");
    assert.equal((await upload(area, file, { ...HEADERS, origin: "http://localhost", "sec-fetch-site": "same-origin" })).status, 200, "gleiche Herkunft");
    assert.equal((await upload(area, file, { ...HEADERS, "content-length": String(DOC_IMAGE_MAX_BYTES + 10 * 1024 * 1024) })).status, 413, "angekündigte Länge zu groß");
    assert.equal((await upload(area, new File([new Uint8Array(DOC_IMAGE_MAX_BYTES + 1)], "gross.png", { type: "image/png" }))).status, 413, "Datei zu groß");
    assert.equal(await env.db.docImage.count(), before + 1);
  });
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

  it("Kopfzeilen je Dateityp (SEC-12): PDF nur frame-ancestors, Bilder mit sandbox, XML und Unbekanntes immer als Download", async () => {
    await signInWith(["invoices.view"]);
    const file = await env.db.invoiceFile.findUniqueOrThrow({ where: { invoiceId } });
    const SANDBOX = "sandbox; default-src 'none'";
    const cases: Array<{ mime: string; type: string; disposition: RegExp; csp: string | null }> = [
      { mime: "application/pdf", type: "application/pdf", disposition: /^inline;/, csp: "frame-ancestors 'self'" },
      { mime: "image/png", type: "image/png", disposition: /^inline;/, csp: SANDBOX },
      { mime: "application/xml", type: "application/xml", disposition: /^attachment;/, csp: SANDBOX },
      // manipulierter Datenbankeintrag: nie als Seite ausliefern
      { mime: "text/html", type: "application/octet-stream", disposition: /^attachment;/, csp: SANDBOX },
      { mime: "image/svg+xml", type: "application/octet-stream", disposition: /^attachment;/, csp: SANDBOX },
    ];
    for (const c of cases) {
      await env.db.invoiceFile.update({ where: { id: file.id }, data: { mime: c.mime } });
      const res = await get();
      assert.equal(res.headers.get("content-type"), c.type, c.mime);
      assert.match(res.headers.get("content-disposition") ?? "", c.disposition, c.mime);
      assert.equal(res.headers.get("content-security-policy"), c.csp, c.mime);
      assert.equal(res.headers.get("x-content-type-options"), "nosniff", c.mime);
      await res.arrayBuffer();
    }
  });

  it("Dateiname mit Zeilenumbruch und Anführungszeichen schleust keine Kopfzeile ein", async () => {
    await signInWith(["invoices.view"]);
    const file = await env.db.invoiceFile.findUniqueOrThrow({ where: { invoiceId } });
    await env.db.invoiceFile.update({ where: { id: file.id }, data: { name: 'x.pdf"\r\nSet-Cookie: boese=1\r\n\r\n<script>' } });
    const res = await get();
    assert.equal(res.headers.get("set-cookie"), null);
    const disposition = res.headers.get("content-disposition") ?? "";
    assert.equal(/[\r\n]/.test(disposition), false);
    assert.equal(/filename="([^"]*)"/.exec(disposition)?.[1].includes('"'), false);
    await res.arrayBuffer();
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
    const before = (await core.listBackups()).length;
    assert.equal((await post(archive)).status, 401);
    await signInWith(["backup.manage"], { mustChangePassword: true });
    assert.equal((await post(archive)).status, 401);
    await signInWith(["settings.manage"]);
    assert.equal((await post(archive)).status, 403);
    assert.equal((await core.listBackups()).length, before);
  });

  it("Fremdaufrufe werden abgewiesen: ohne eigenen Header oder mit fremder Herkunft", async () => {
    await signInWith(["backup.manage"]);
    const before = (await core.listBackups()).length;
    assert.equal((await post(archive, { host: "localhost" })).status, 403, "ohne X-Requested-With");
    assert.equal((await post(archive, { "x-requested-with": "irgendwas", host: "localhost" })).status, 403);
    assert.equal((await post(archive, { "x-requested-with": "schrauberos", host: "localhost", origin: "https://evil.example" })).status, 403, "fremde Herkunft");
    assert.equal((await core.listBackups()).length, before);
    assert.equal((await post(archive, { "x-requested-with": "schrauberos", host: "localhost", origin: "http://localhost" })).status, 200, "gleiche Herkunft ist in Ordnung");
  });

  it("legt eine gültige Sicherung als „upload“ an, räumt die Zwischendatei weg und protokolliert", async () => {
    await signInWith(["backup.manage"]);
    const res = await post(archive);
    assert.equal(res.status, 200);
    const { name } = (await res.json()) as { name: string };
    assert.match(name, /-upload$/);
    assert.ok((await core.listBackups()).some((b) => b.name === name));
    assert.deepEqual(uploads(), []);
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "backup.upload" } });
    assert.equal(entry.target, name);
  });

  it("Start läuft noch (Migrationen): 503 „starting“, auch mit Sitzung – es wird nichts angelegt", async () => {
    await signInWith(["backup.manage"]);
    const state = startupState();
    const before = state.status;
    const count = (await core.listBackups()).length;
    state.status = "starting";
    try {
      const res = await post(archive);
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { status: "starting" });
    } finally {
      state.status = before;
    }
    assert.equal((await core.listBackups()).length, count);
    assert.deepEqual(uploads(), []);
  });

  it("Zustand „Neuinstallation nötig“: 503, auch mit Sitzung – die Route läuft nicht durch den Proxy und beantwortet das selbst, es wird nichts angelegt", async () => {
    await signInWith(["backup.manage"]);
    const state = startupState();
    const before = state.status;
    const count = (await core.listBackups()).length;
    state.status = "reinstall";
    try {
      const res = await post(archive);
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { status: "reinstall" });
    } finally {
      state.status = before;
    }
    assert.equal((await core.listBackups()).length, count);
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

  it("Archive mit Symlink, Hardlink, „..“-Pfad oder absolutem Pfad werden abgelehnt (422), nichts wird angelegt oder außerhalb geschrieben (SEC-14)", async () => {
    await signInWith(["backup.manage"]);
    const before = (await core.listBackups()).length;
    const outside = path.join(env.dir, "draussen.txt");
    const evil: Array<[string, RawEntry[]]> = [
      ["Symlink", [{ name: "files/link", type: "2", linkname: "../../secret.key" }]],
      ["Hardlink", [{ name: "files/hart", type: "1", linkname: "../secret.key" }]],
      ["..-Pfad", [{ name: "../../draussen.txt", data: "böse" }]],
      ["absoluter Pfad", [{ name: `/${outside.split(String.fromCharCode(92)).join("/").replace(/^[A-Za-z]:/, "").replace(/^\/+/, "")}`, data: "böse" }]],
      ["Geräte-Datei", [{ name: "dev", type: "3" }]],
    ];
    for (const [name, entries] of evil) {
      const res = await post(rawTar([{ name: "database.db.gz", data: "x" }, ...entries]));
      assert.equal(res.status, 422, name);
      assert.equal(((await res.json()) as { error: string }).error, "notBackup", name);
    }
    assert.equal(existsSync(outside), false);
    assert.equal((await core.listBackups()).length, before);
    assert.deepEqual(uploads(), []);
    assert.deepEqual(readdirSync(core.backupsDir()).filter((f) => f.startsWith(".import-")), [], "keine halben Entpackordner");
  });

  it("Schutz der Platte: angekündigte Größe über der Obergrenze 413, passt sie nicht in den freien Platz 507, während des Empfangs wird der freie Platz laufend geprüft", async () => {
    await signInWith(["backup.manage"]);
    const before = (await core.listBackups()).length;
    const GiB = 1024 ** 3;
    assert.equal((await post(archive, { "x-requested-with": "schrauberos", host: "localhost", "content-length": String(101 * GiB) })).status, 413);

    setFreeBytesForTest(async () => 1 * GiB);
    try {
      const announced = await post(archive, { "x-requested-with": "schrauberos", host: "localhost", "content-length": String(600 * 1024 * 1024) });
      assert.equal(announced.status, 507, "600 MB brauchen als Datei und entpackt mehr als 1 GiB frei");
      assert.equal(((await announced.json()) as { error: string }).error, "diskFull");

      // ohne Längenangabe: der Platz schwindet mitten im Empfang (nach 64 MiB wird geprüft)
      let left = 10 * GiB;
      setFreeBytesForTest(async () => left);
      const big = Buffer.alloc(70 * 1024 * 1024, 1);
      left = DISK_RESERVE_BYTES - 1;
      const streamed = await post(big);
      assert.equal(streamed.status, 507);
    } finally {
      setFreeBytesForTest(null);
    }
    assert.equal((await core.listBackups()).length, before);
    assert.deepEqual(uploads(), [], "die halbe Datei ist gelöscht");
    const failures = await env.db.auditLog.findMany({ where: { action: "backup.uploadFailed" } });
    assert.ok(failures.some((f) => f.target === "diskFull"));
  });

  it("Müll, leerer Body und fremde Datenbanken: abgelehnt (422/400), Zwischendatei weg, Fehlschlag im Audit – nur mit Fehlercode", async () => {
    await signInWith(["backup.manage"]);
    const before = (await core.listBackups()).length;
    const junk = await post(Buffer.from("das ist kein Backup, nur Müll mit Geheimnis hunter2"));
    assert.equal(junk.status, 422);
    const body = (await junk.json()) as { error: string };
    assert.ok(["notBackup", "corrupt"].includes(body.error));
    assert.equal((await post(null)).status, 400);
    assert.equal((await core.listBackups()).length, before);
    assert.deepEqual(uploads(), []);
    const failures = await env.db.auditLog.findMany({ where: { action: "backup.uploadFailed" } });
    assert.ok(failures.length >= 1);
    assert.equal(JSON.stringify(failures).includes("hunter2"), false, "kein Dateiinhalt im Audit-Log");
    assert.equal(existsSync(path.join(core.backupsDir(), ".upload-")), false);
  });
});
