import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { after, before, describe, it } from "node:test";
import { isForbiddenHost, normalizeRemotePath, normalizeWebdavUrl, planDeletions, planUploads } from "@/lib/offsite/target";
import { LINEAR_MAX_RATIO, measureLinearity } from "@/test/timing";
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

describe("Multistatus-Parser: linear, auch bei feindlichen Antworten (ZP5-3)", () => {
  const MIB = 1024 * 1024;
  /**
   * Linearität statt fester Millisekunden (Z6-4 M-3): jede Eingabe wird in der Größe `n` und `4 n` erzeugt (`n` = 1 MiB, größte Eingabe 4 MiB); ein linearer Parser braucht für `4 n` etwa die vierfache
   * Zeit, der frühere quadratische Regulärausdruck die sechzehnfache (bei 16 MiB Stunden). Das Verhältnis hängt nicht an der Last des Rechners.
   */
  const big = (unit: string, bytes: number) => unit.repeat(Math.ceil(bytes / unit.length));

  const cases: Array<[string, (n: number) => string]> = [
    ["Millionen offene response-Tags ohne Ende (der Fall des quadratischen Regulärausdrucks)", (n) => big("<D:response>", n)],
    ["Millionen offene response-Tags mit href, ohne Ende", (n) => big("<D:response><D:href>/a</D:href>", n)],
    ["nur '<' ohne '>'", (n) => big("<", n)],
    ["Tag ohne Ende, immer wieder", (n) => big("<a ", n)],
    ["tief verschachtelte Tags", (n) => big("<a>", n)],
    ["ein href ohne Ende (Text ohne schließenden Tag)", (n) => `<response><href>${"x".repeat(n)}`],
    ["unterbrochener CDATA-Abschnitt", (n) => `<response><href><![CDATA[${"x".repeat(n)}`],
    ["unterbrochener Kommentar", (n) => `<!--${"-".repeat(n)}`],
    ["viele ineinander geschachtelte Entitäten und Kaufmannsund", (n) => `<response><href>${"&amp;".repeat(Math.ceil(n / 5))}</href></response>`],
    ["Millionen leerer resourcetype/collection-Tags", (n) => `<response><href>/x</href>${big("<resourcetype><collection/>", n)}</response>`],
    ["Millionen schließende Tags", (n) => big("</response>", n)],
    ["Millionen Verarbeitungsanweisungen und DOCTYPE", (n) => big("<?x?><!DOCTYPE a>", n)],
  ];
  for (const [name, build] of cases) {
    it(name, () => {
      let entries = 0;
      const { ratio, smallMs, largeMs } = measureLinearity(build, (xml) => (entries = parseMultistatus(xml).length), MIB);
      assert.ok(ratio < LINEAR_MAX_RATIO, `vierfache Größe braucht das ${ratio.toFixed(1)}-fache (${Math.round(smallMs)} ms → ${Math.round(largeMs)} ms) – linear wäre etwa 4`);
      assert.ok(entries <= 5000, "die Zahl der Einträge ist begrenzt");
    });
  }

  it("Einträge sind auf 5000 begrenzt, die Auswertung hört dann auf", () => {
    const xml = `<multistatus>${big("<response><href>/a/b.sobk</href><propstat><prop><getcontentlength>1</getcontentlength></prop></propstat></response>", 8 * MIB)}</multistatus>`;
    const entries = parseMultistatus(xml);
    assert.equal(entries.length, 5000);
    // die Obergrenze verkürzt die Arbeit: 8 MiB mit Abbruch nach 5000 Einträgen dauern nicht länger als 1 MiB mit der gleichen Arbeit bis zum Abbruch (Verhältnis statt Millisekunden)
    const { ratio } = measureLinearity((n) => `<multistatus>${big("<response><href>/a/b.sobk</href></response>", n)}</multistatus>`, (x) => parseMultistatus(x), MIB);
    assert.ok(ratio < LINEAR_MAX_RATIO, `Verhältnis ${ratio.toFixed(1)}`);
  });

  it("wertet Kommentare, CDATA, selbstschließende Tags, Zeichenverweise und Namensräume richtig aus", () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE multistatus [<!ENTITY x "bösartig">]><d:multistatus xmlns:d="DAV:"><!-- <d:response><d:href>/falsch</d:href></d:response> -->
      <d:response><d:href>/dav/a%26b&amp;c&#x2e;sobk</d:href><d:propstat><d:prop><d:getcontentlength> 42 </d:getcontentlength><d:getlastmodified>Wed, 01 Jan 2026 02:00:00 GMT</d:getlastmodified><d:resourcetype/></d:prop></d:propstat></d:response>
      <d:response><d:href>/dav/ordner/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype><d:getcontentlength>x</d:getcontentlength></d:prop></d:propstat></d:response>
      <d:response/></d:multistatus>`;
    const entries = parseMultistatus(xml);
    assert.deepEqual(entries.map((e) => ({ href: e.href, size: e.size, collection: e.collection })), [
      { href: "/dav/a&b&c.sobk", size: 42, collection: false },
      { href: "/dav/ordner/", size: 0, collection: true },
    ]);
    assert.equal(entries[0].modifiedAt?.toISOString(), "2026-01-01T02:00:00.000Z");
  });

  it("eigene Entitäten aus einem DOCTYPE werden nicht aufgelöst", () => {
    const xml = '<!DOCTYPE a [<!ENTITY big "AAAAAAAAAA"><!ENTITY bigger "&big;&big;&big;">]><response><href>/x&bigger;</href></response>';
    assert.equal(parseMultistatus(xml)[0].href, "/x&bigger;");
  });

  it("eine zu große Antwort wird vom Transport abgewiesen, ohne sie auszuwerten", async () => {
    const t = new WebdavTransport(
      "https://dav.example/ordner",
      { username: "u", password: "p" },
      {
        fetchImpl: (async (_url: string, init?: { method?: string }) =>
          init?.method === "PROPFIND" && (init as { headers?: Record<string, string> }).headers?.Depth === "1"
            ? new Response(new ReadableStream({ pull: (c) => c.enqueue(new Uint8Array(1024 * 1024).fill(32)) }), { status: 207 })
            : new Response(null, { status: 207 })) as unknown as typeof fetch,
      },
    );
    assert.equal(await codeOf(t.list()), "server");
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
