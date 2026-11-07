import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { after, before, describe, it } from "node:test";
import { isForbiddenHost, normalizeRemotePath, normalizeWebdavUrl, planDeletions, planUploads } from "@/lib/offsite/target";
import { startFakeWebdav, type FakeWebdav } from "@/test/fake-webdav";
import { OffsiteError } from "./transport";
import { parseMultistatus, WebdavTransport } from "./webdav";

let server: FakeWebdav;
before(async () => {
  server = await startFakeWebdav();
});
after(() => server.close());

const make = (overrides: { password?: string; idleMs?: number; requestMs?: number } = {}) =>
  new WebdavTransport(server.url, { username: "sicherung", password: overrides.password ?? "geheim" }, { idleMs: overrides.idleMs ?? 5000, requestMs: overrides.requestMs ?? 5000 });

const read = async (stream: Readable) => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof OffsiteError ? error.code : `other:${(error as Error).message}`;
  }
  return "ok";
}

describe("WebDAV-Ziel", () => {
  it("legt das Verzeichnis an, lädt gestreamt hoch (erst .part, dann umbenannt), listet, liest und löscht", async () => {
    const t = make();
    assert.deepEqual(await t.list(), [], "leeres Verzeichnis wird angelegt");
    const data = randomBytes(300_000);
    await t.put("schrauberos-20260101T020000Z-auto.sobk", Readable.from([data.subarray(0, 1000), data.subarray(1000)]));
    assert.ok(server.files.has("schrauberos-20260101T020000Z-auto.sobk"));
    assert.ok(![...server.files.keys()].some((n) => n.endsWith(".part")), "keine halbe Datei bleibt liegen");
    const sequence = server.requests.map((r) => r.method).join(",");
    assert.match(sequence, /PUT,MOVE/);
    const [entry] = await t.list();
    assert.equal(entry.name, "schrauberos-20260101T020000Z-auto.sobk");
    assert.equal(entry.size, data.length);
    assert.ok(entry.modifiedAt instanceof Date);
    assert.ok((await read(await t.get(entry.name))).equals(data));
    await t.remove(entry.name);
    assert.deepEqual(await t.list(), []);
    await t.remove(entry.name); // schon weg: kein Fehler
  });

  it("meldet falsche Zugangsdaten als auth", async () => {
    assert.equal(await codeOf(make({ password: "falsch" }).list()), "auth");
  });

  it("verfolgt keine Weiterleitungen (auch nicht auf einen anderen Host) und sendet nichts dorthin", async () => {
    const other = await startFakeWebdav("/x");
    try {
      server.options.redirectTo = `${other.url}/stolen`;
      assert.equal(await codeOf(make().list()), "server");
      assert.equal(await codeOf(make().put("a.sobk", Readable.from([Buffer.from("x")]))), "server");
      assert.equal(other.requests.length, 0, "die Anfrage samt Zugangsdaten ging nicht an den anderen Host");
    } finally {
      server.options.redirectTo = null;
      await other.close();
    }
  });

  it("räumt bei abgelehntem Hochladen auf und meldet einen Fehler des Ziels", async () => {
    server.options.failPut = true;
    try {
      assert.equal(await codeOf(make().put("b.sobk", Readable.from([randomBytes(1000)]))), "server");
    } finally {
      server.options.failPut = false;
    }
    assert.ok(!server.files.has("b.sobk"));
  });

  it("bricht ein Ziel, das nie antwortet, nach dem Zeitlimit ab", async () => {
    server.options.stallPut = true;
    try {
      assert.equal(await codeOf(make({ idleMs: 300 }).put("c.sobk", new Readable({ read() { /* liefert nichts mehr */ } }))), "timeout");
    } finally {
      server.options.stallPut = false;
    }
  });

  it("meldet ein nicht erreichbares Ziel als connect", async () => {
    const t = new WebdavTransport("http://127.0.0.1:9/dav", { username: "u", password: "p" }, { requestMs: 3000 });
    assert.equal(await codeOf(t.list()), "connect");
  });

  it("liest Multistatus-Antworten verschiedener Server (Namensräume, Entitäten, ohne Größe)", () => {
    const xml = `<?xml version="1.0"?><multistatus xmlns="DAV:"><response><href>/a/b%20c.sobk</href><propstat><prop><getcontentlength>12</getcontentlength><getlastmodified>Wed, 01 Jan 2026 02:00:00 GMT</getlastmodified><resourcetype/></prop></propstat></response>
      <ns0:response xmlns:ns0="DAV:"><ns0:href>/a/ordner/</ns0:href><ns0:propstat><ns0:prop><ns0:resourcetype><ns0:collection/></ns0:resourcetype></ns0:prop></ns0:propstat></ns0:response></multistatus>`;
    const entries = parseMultistatus(xml);
    assert.equal(entries.length, 2);
    assert.deepEqual({ href: entries[0].href, size: entries[0].size, collection: entries[0].collection }, { href: "/a/b c.sobk", size: 12, collection: false });
    assert.equal(entries[0].modifiedAt?.toISOString(), "2026-01-01T02:00:00.000Z");
    assert.equal(entries[1].collection, true);
  });
});

describe("Ziel-Prüfung (SSRF-Bedacht)", () => {
  it("WebDAV nur über HTTPS; Klartext nur für den eigenen Rechner", () => {
    assert.deepEqual(normalizeWebdavUrl("https://cloud.example.org/remote.php/dav/files/x/backups/"), { ok: true, url: "https://cloud.example.org/remote.php/dav/files/x/backups" });
    assert.deepEqual(normalizeWebdavUrl("http://127.0.0.1:8080/dav"), { ok: true, url: "http://127.0.0.1:8080/dav" });
    assert.deepEqual(normalizeWebdavUrl("http://nas.local/dav"), { ok: false, problem: "scheme" });
    assert.deepEqual(normalizeWebdavUrl("ftp://nas/dav"), { ok: false, problem: "scheme" });
    assert.deepEqual(normalizeWebdavUrl("https://u:p@nas/dav"), { ok: false, problem: "credentialsInUrl" });
    assert.deepEqual(normalizeWebdavUrl("https://nas/dav?x=1"), { ok: false, problem: "url" });
    assert.deepEqual(normalizeWebdavUrl("https://169.254.169.254/latest"), { ok: false, problem: "forbiddenHost" });
    assert.deepEqual(normalizeWebdavUrl("kein url"), { ok: false, problem: "url" });
  });

  it("sperrt Metadaten- und Verbindungs-lokale Adressen, nicht aber das LAN", () => {
    for (const host of ["169.254.169.254", "169.254.0.5", "[fe80::1]", "fe80::1", "metadata.google.internal", "0.0.0.0"]) assert.ok(isForbiddenHost(host), host);
    for (const host of ["192.168.1.20", "10.0.0.5", "nas.local", "backup.example.org"]) assert.ok(!isForbiddenHost(host), host);
  });

  it("Verzeichnis am Ziel: kein .., keine Steuerzeichen", () => {
    assert.equal(normalizeRemotePath("/srv/backups/"), "/srv/backups");
    assert.equal(normalizeRemotePath("backups//schrauberos"), "backups/schrauberos");
    assert.equal(normalizeRemotePath("../etc"), null);
    assert.equal(normalizeRemotePath("a/../b"), null);
    assert.equal(normalizeRemotePath("a\u0000b"), null);
    assert.equal(normalizeRemotePath("   "), null);
  });
});

describe("Planung (Hochladen und Aufbewahrung am Ziel)", () => {
  const at = (n: number) => new Date(Date.UTC(2026, 0, n));
  const local = [1, 2, 3, 4].map((n) => ({ name: `schrauberos-2026010${n}T020000Z-auto`, kind: "auto", createdAt: at(n) }));

  it("lädt nur auto/manual hoch, die neuesten `keep`, soweit sie fehlen (neueste zuerst)", () => {
    const withOthers = [...local, { name: "schrauberos-20260105T020000Z-pre-update", kind: "pre-update", createdAt: at(5) }, { name: "schrauberos-20260106T020000Z-manual", kind: "manual", createdAt: at(6) }];
    assert.deepEqual(planUploads(withOthers, new Set(), 3), ["schrauberos-20260106T020000Z-manual", "schrauberos-20260104T020000Z-auto", "schrauberos-20260103T020000Z-auto"]);
    assert.deepEqual(planUploads(withOthers, new Set(["schrauberos-20260104T020000Z-auto"]), 3), ["schrauberos-20260106T020000Z-manual", "schrauberos-20260103T020000Z-auto"]);
  });

  it("löscht nur eigene Dateien jenseits der neuesten `keep` – fremde nie", () => {
    const remote = [
      "schrauberos-20260101T020000Z-auto.sobk",
      "schrauberos-20260102T020000Z-auto.sobk",
      "schrauberos-20260103T020000Z-manual.sobk",
      "schrauberos-20260104T020000Z-auto.sobk",
      "meine-urlaubsfotos.zip",
      "schrauberos-notizen.txt",
      "schrauberos-20260101T020000Z-auto.sobk.bak",
      "schrauberos-20260101T020000Z-auto.tar",
    ].map((name) => ({ name, size: 1, modifiedAt: null }));
    assert.deepEqual(planDeletions(remote, 2, at(10)), ["schrauberos-20260102T020000Z-auto.sobk", "schrauberos-20260101T020000Z-auto.sobk"]);
    assert.deepEqual(planDeletions(remote, 10, at(10)), []);
  });

  it("räumt unfertige Übertragungen erst nach einem Tag auf", () => {
    const old = { name: "schrauberos-20260101T020000Z-auto.sobk.part", size: 1, modifiedAt: new Date(at(10).getTime() - 2 * 86_400_000) };
    const fresh = { name: "schrauberos-20260102T020000Z-auto.sobk.part", size: 1, modifiedAt: new Date(at(10).getTime() - 3600_000) };
    assert.deepEqual(planDeletions([old, fresh], 5, at(10)), [old.name]);
  });
});
