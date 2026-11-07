import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { after, before, describe, it } from "node:test";
import { startFakeSftp, type FakeSftp } from "@/test/fake-sftp";
import { fetchSftpHostKey, SftpTransport, type SftpConfig } from "./sftp";
import { OffsiteError } from "./transport";

let server: FakeSftp;
before(async () => {
  server = await startFakeSftp();
});
after(() => server.close());

const config = (overrides: Partial<SftpConfig> = {}): SftpConfig => ({
  host: "127.0.0.1",
  port: server.port,
  username: "sicherung",
  path: "/srv/backups",
  hostKey: server.fingerprint,
  credentials: { password: "geheim" },
  readyTimeoutMs: 5000,
  idleMs: 5000,
  ...overrides,
});

const read = async (stream: Readable) => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};

async function errorOf(promise: Promise<unknown>): Promise<OffsiteError | Error | null> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  return null;
}

describe("SFTP-Ziel (ssh2, reine JavaScript-Variante)", () => {
  it("lädt ssh2 ohne native Teile", async () => {
    const ssh2 = await import("ssh2");
    assert.equal(typeof (ssh2.Client ?? (ssh2 as { default?: { Client?: unknown } }).default?.Client), "function");
    const { existsSync } = await import("node:fs");
    const { createRequire } = await import("node:module");
    const dir = createRequire(import.meta.url ?? __filename).resolve("ssh2").replace(/index\.js$/, "");
    assert.equal(existsSync(`${dir}lib/protocol/crypto/build/Release/sshcrypto.node`), false, "keine native Bibliothek gebaut");
  });

  it("ruft den Fingerabdruck des Hostschlüssels ab, ohne sich anzumelden", async () => {
    const before = server.authAttempts;
    assert.equal(await fetchSftpHostKey("127.0.0.1", server.port, 5000), server.fingerprint);
    assert.equal(server.authAttempts, before);
  });

  it("verbindet mit dem hinterlegten Hostschlüssel: Verzeichnis anlegen, hochladen (.part → umbenannt), listen, lesen, löschen", async () => {
    const t = await SftpTransport.connect(config());
    try {
      assert.deepEqual(await t.list(), []);
      assert.ok(server.dirs.has("/srv") && server.dirs.has("/srv/backups"));
      const data = randomBytes(200_000);
      await t.put("schrauberos-20260101T020000Z-auto.sobk", Readable.from([data.subarray(0, 5000), data.subarray(5000)]));
      assert.ok(server.files.has("/srv/backups/schrauberos-20260101T020000Z-auto.sobk"));
      assert.ok(![...server.files.keys()].some((p) => p.endsWith(".part")));
      const [entry] = await t.list();
      assert.equal(entry.name, "schrauberos-20260101T020000Z-auto.sobk");
      assert.equal(entry.size, data.length);
      assert.ok((await read(await t.get(entry.name))).equals(data));
      // Namen ersetzen: das Ziel besteht schon (SFTP v3 lehnt das Umbenennen ab) → es wird ersetzt
      await t.put("schrauberos-20260101T020000Z-auto.sobk", Readable.from([Buffer.from("neu")]));
      assert.equal(server.files.get("/srv/backups/schrauberos-20260101T020000Z-auto.sobk")!.toString(), "neu");
      await t.remove(entry.name);
      await t.remove(entry.name);
      assert.deepEqual(await t.list(), []);
      assert.equal((await errorOf(t.get("gibt-es-nicht.sobk")))?.message.startsWith("notFound"), true);
    } finally {
      await t.close();
    }
  });

  it("bricht bei abweichendem Hostschlüssel ab – ohne je Zugangsdaten zu senden", async () => {
    const before = server.authAttempts;
    const error = await errorOf(SftpTransport.connect(config({ hostKey: `SHA256:${"A".repeat(43)}` })));
    assert.ok(error instanceof OffsiteError);
    assert.equal(error.code, "hostKey");
    assert.equal(error.fingerprint, server.fingerprint, "der gesehene Wert wird gemeldet");
    assert.equal(server.authAttempts, before, "es gab keinen Anmeldeversuch");
  });

  it("meldet ein falsches Passwort als auth", async () => {
    const error = await errorOf(SftpTransport.connect(config({ credentials: { password: "falsch" } })));
    assert.ok(error instanceof OffsiteError);
    assert.equal(error.code, "auth");
  });

  it("meldet ein nicht erreichbares Ziel als connect", async () => {
    const error = await errorOf(SftpTransport.connect(config({ port: 9 })));
    assert.ok(error instanceof OffsiteError);
    assert.equal(error.code, "connect");
  });

  it("verlangt Zugangsdaten und lehnt Pfad-Dateinamen ab", async () => {
    assert.equal(((await errorOf(SftpTransport.connect(config({ credentials: {} })))) as OffsiteError).code, "config");
    const t = await SftpTransport.connect(config());
    try {
      assert.equal(((await errorOf(t.remove("../../etc/passwd"))) as OffsiteError).code, "config");
      assert.equal(((await errorOf(t.get("a/b"))) as OffsiteError).code, "config");
    } finally {
      await t.close();
    }
  });
});
