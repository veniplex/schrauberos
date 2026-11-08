import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { after, before, beforeEach, describe, it } from "node:test";
import { versionOf } from "@/lib/concurrency";
import { createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";

/**
 * IT-Tresor (F13): Kryptographie (AES-GCM mit AAD, Eintragsschlüssel, IV-Eindeutigkeit, Manipulation, Formatversion, Rotation), Rechte (auch Administratoren nur ausdrücklich), Anzeigen nur mit Passwort,
 * Limit und Audit ohne Inhalt, Klartext nirgends sonst (Datenbank, Audit, Log, Suche, API, Webhooks, CSV), Zustände von `secret.key` (fehlt, fremd, Wiederherstellungsschlüssel) und die Sicherung vor dem Zurücksetzen.
 */
const PASSWORD = "ein-gutes-passwort-123";
const MARK = { url: "https://marker-url-q8.example/login", username: "marker-user-q8", secret: "Marker-Pw-Zx93!kq", note: "marker-note-q8 Hinweis" };

let env: TestEnv;
let actions: typeof import("./vault-actions");
let crypto: typeof import("./vault-crypto");
let queries: typeof import("./vault-queries");
let secrets: typeof import("@/server/secrets");
let secretReset: typeof import("@/server/secret-reset");
let issueMod: typeof import("@/server/secret-key-issue");
let recoveryKey: typeof import("@/server/recovery-key");
let recoveryMod: typeof import("@/server/secret-key-recovery");
let throttle: typeof import("@/server/auth/throttle");
let runtime: typeof import("@/server/auth/runtime");

const keyPath = () => path.join(env.dir, "secret.key");
const writeKey = (hex = randomBytes(32).toString("hex")) => {
  rmSync(keyPath(), { recursive: true, force: true });
  writeFileSync(keyPath(), hex);
  return hex;
};
const logged: string[] = [];
const real = { log: console.log, error: console.error, warn: console.warn, info: console.info };

before(async () => {
  env = await createTestEnv();
  actions = await import("./vault-actions");
  crypto = await import("./vault-crypto");
  queries = await import("./vault-queries");
  secrets = await import("@/server/secrets");
  secretReset = await import("@/server/secret-reset");
  issueMod = await import("@/server/secret-key-issue");
  recoveryKey = await import("@/server/recovery-key");
  recoveryMod = await import("@/server/secret-key-recovery");
  throttle = await import("@/server/auth/throttle");
  runtime = await import("@/server/auth/runtime");
  runtime.authRuntime.sleep = async () => undefined;
  for (const level of ["log", "error", "warn", "info"] as const) console[level] = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
});
after(async () => {
  Object.assign(console, real);
  await env.cleanup();
});

beforeEach(async () => {
  rmSync(path.join(env.dir, "secret-reset"), { recursive: true, force: true });
  rmSync(path.join(env.dir, "restore"), { recursive: true, force: true });
  for (const f of readdirSync(env.dir).filter((n) => n.startsWith("secret.key."))) rmSync(path.join(env.dir, f), { recursive: true, force: true });
  await env.db.vaultEntry.deleteMany();
  await env.db.outboxEvent.deleteMany();
  await env.db.auditLog.deleteMany();
  await env.db.appSetting.deleteMany();
  await env.db.session.deleteMany();
  await env.db.user.deleteMany();
  await env.db.role.deleteMany();
  throttle.resetLoginThrottle();
  env.browser.reset();
  logged.length = 0;
  writeKey();
});

let n = 0;
/** Konto mit Passwort und den Rechten (oder als Administrator, optional mit zusätzlicher Rolle) – angemeldet */
async function login(permissions: string[], options: { admin?: boolean; extra?: string[] } = {}) {
  n++;
  const roles = [await env.role({ key: `r-${n}`, isAdmin: options.admin, permissions })];
  if (options.extra) roles.push(await env.role({ key: `x-${n}`, permissions: options.extra }));
  const user = await env.user({ username: `u-${n}`, password: PASSWORD, roles });
  await env.signIn(user);
  return user;
}
const BOTH = ["docsIt.vault", "docsIt.vaultManage"];

/** Eintrag direkt anlegen (wie die Operation: Zeile, dann verschlüsseln) */
async function makeEntry(title = "Firewall", secret: Partial<ReturnType<typeof markSecret>> = markSecret()) {
  const row = await env.db.vaultEntry.create({ data: { title, kind: "network", system: "fw-01" } });
  const sealed = crypto.sealVaultEntry(row.id, 1, { title, kind: "network", system: "fw-01" }, { ...crypto.EMPTY_SECRET, ...secret });
  return env.db.vaultEntry.update({ where: { id: row.id }, data: sealed });
}
const markSecret = () => ({ ...MARK });
/** Speichern; das Passwort der handelnden Person steht dabei (nötig, wenn die hinterlegten Zugangsdaten eines Eintrags geändert werden) – `password: undefined` lässt es weg */
const save = (fields: Record<string, string | number | boolean | undefined> = {}) => actions.saveVaultEntry({}, form({ title: "Firewall", kind: "network", system: "fw-01", ...MARK, password: PASSWORD, ...fields }));
const reveal = (id: string, password = PASSWORD) => actions.revealVaultEntry({}, form({ id, password }));
const audits = async () => (await env.db.auditLog.findMany({ orderBy: { createdAt: "asc" } })).map((e) => `${e.action} ${e.target}`);

/** Alle Tabellen der Datenbank als Text (zum Suchen nach Klartext) */
function dumpDatabase(): string {
  const db = new Database(path.join(env.dir, "test.db"), { readonly: true });
  try {
    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as Array<{ name: string }>).map((t) => t.name);
    return tables.map((name) => JSON.stringify(db.prepare(`SELECT * FROM "${name}"`).all())).join("\n");
  } finally {
    db.close();
  }
}
const markers = Object.values(MARK);
const assertNoPlaintext = (text: string, where: string) => {
  for (const marker of markers) assert.ok(!text.includes(marker), `${where}: Klartext „${marker}“ gefunden`);
};

describe("Kryptographie", () => {
  const LABEL: { title: string; kind: string; system: string | null } = { title: "Firewall", kind: "network", system: "fw-01" };
  const entry = (id: string, sealed: ReturnType<typeof crypto.sealVaultEntry>, label = LABEL) => ({ id, ...label, ...sealed });
  /** Teil `index` (1 = IV, 2 = Tag, 3 = Daten) eines Blocks verändern: ein Bit kippen */
  const flip = (blob: string, index: number) => {
    const parts = blob.split(":");
    const bytes = Buffer.from(parts[index], "base64");
    bytes[0] ^= 1;
    parts[index] = bytes.toString("base64");
    return parts.join(":");
  };

  it("Hin und zurück; der verschlüsselte Block und der umhüllte Schlüssel enthalten nichts im Klartext", () => {
    const sealed = crypto.sealVaultEntry("e1", 1, LABEL, markSecret());
    assert.equal(sealed.format, 1);
    assertNoPlaintext(`${sealed.payload}\n${sealed.wrappedKey}`, "Block");
    for (const marker of markers) assert.ok(!Buffer.from(sealed.payload.split(":")[3], "base64").toString("latin1").includes(marker.slice(0, 8)), "auch im entschlüsselten Rohblock des Chiffrats ist nichts lesbar");
    assert.match(sealed.payload, /^p1:[A-Za-z0-9+/=]{16}:[A-Za-z0-9+/=]{24}:[A-Za-z0-9+/=]+$/);
    assert.match(sealed.wrappedKey, /^b1:/);
    assert.equal(secrets.isSecretBlob(sealed.wrappedKey), false, "kein Geheimnis der Einstellungen (der Einstellungs-Reset fasst es nie an)");
    assert.deepEqual(crypto.openVaultEntry(entry("e1", sealed)), { ok: true, secret: markSecret() });
  });

  it("Eintrags-ID als AAD: Block oder Schlüssel in einen anderen Eintrag verschoben lässt sich nicht öffnen", () => {
    const a = crypto.sealVaultEntry("a", 1, LABEL, markSecret());
    const b = crypto.sealVaultEntry("b", 1, LABEL, { ...markSecret(), secret: "anderes-Geheimnis" });
    assert.equal(crypto.openVaultEntry(entry("a", a)).ok, true);
    // Block von b unter a: der Schlüssel von a öffnet ihn nicht
    assert.deepEqual(crypto.openVaultEntry(entry("a", { ...a, payload: b.payload })), { ok: false, reason: "damaged" });
    // Schlüssel von b unter a: nicht für diese Zeile umhüllt
    assert.deepEqual(crypto.openVaultEntry(entry("a", { ...a, wrappedKey: b.wrappedKey })), { ok: false, reason: "unreadable" });
    // beides vertauscht: unter der ID b geöffnet, ist der Schlüssel von a nicht für b umhüllt
    assert.deepEqual(crypto.openVaultEntry(entry("b", a)), { ok: false, reason: "unreadable" });
  });

  it("Format und Revision stecken in der AAD: eine andere Revision öffnet nie, ein unbekanntes Format ist „nicht unterstützt“ (nie beschädigt)", () => {
    const sealed = crypto.sealVaultEntry("e", 3, LABEL, markSecret());
    assert.equal(crypto.openVaultEntry(entry("e", sealed)).ok, true);
    assert.deepEqual(crypto.openVaultEntry(entry("e", { ...sealed, revision: 2 })), { ok: false, reason: "damaged" });
    assert.deepEqual(crypto.openVaultEntry(entry("e", { ...sealed, revision: 4 })), { ok: false, reason: "damaged" });
    assert.deepEqual(crypto.openVaultEntry(entry("e", { ...sealed, format: 2 })), { ok: false, reason: "unsupported" });
  });

  it("Titel, Art und System stecken in der AAD: vertauschte Beschriftungen öffnen nie (statt falscher Zugangsdaten unter einem vertrauten Titel)", () => {
    const sealed = crypto.sealVaultEntry("e", 1, LABEL, markSecret());
    assert.equal(crypto.openVaultEntry(entry("e", sealed)).ok, true);
    for (const other of [{ ...LABEL, title: "Router" }, { ...LABEL, kind: "server" }, { ...LABEL, system: "fw-02" }, { ...LABEL, system: null }]) {
      assert.deepEqual(crypto.openVaultEntry(entry("e", sealed, other)), { ok: false, reason: "damaged" }, JSON.stringify(other));
    }
    // kein System und leeres System sind dasselbe
    const none = crypto.sealVaultEntry("e", 1, { ...LABEL, system: null }, markSecret());
    assert.equal(crypto.openVaultEntry(entry("e", none, { ...LABEL, system: null })).ok, true);
  });

  it("Manipulation: ein veränderter Block (Chiffrat, Tag, IV), ein veränderter Schlüssel oder Unsinn öffnet nie – nie ein Klartext, nie eine Ausnahme", () => {
    const sealed = crypto.sealVaultEntry("e", 1, LABEL, markSecret());
    for (const index of [1, 2, 3]) assert.deepEqual(crypto.openVaultEntry(entry("e", { ...sealed, payload: flip(sealed.payload, index) })), { ok: false, reason: "damaged" }, `Teil ${index}`);
    for (const index of [1, 2, 3]) assert.equal(crypto.openVaultEntry(entry("e", { ...sealed, wrappedKey: flip(sealed.wrappedKey, index) })).ok, false, `Schlüsselteil ${index}`);
    // ein gut geformter, aber veränderter umhüllter Schlüssel ist „fremder Schlüssel“ (nicht zu unterscheiden)
    assert.deepEqual(crypto.openVaultEntry(entry("e", { ...sealed, wrappedKey: flip(sealed.wrappedKey, 3) })), { ok: false, reason: "unreadable" });
    for (const payload of ["p1", "p1:::", "Unsinn", `${sealed.payload}:extra`, `${sealed.payload}`.replace(/:[^:]*$/, ":%%%")]) {
      assert.deepEqual(crypto.openVaultEntry(entry("e", { ...sealed, payload })), { ok: false, reason: "damaged" }, payload);
    }
    // eine höhere Version ist nicht beschädigt, sondern unbekannt
    assert.deepEqual(crypto.openVaultEntry(entry("e", { ...sealed, payload: "p2:a:b:c" })), { ok: false, reason: "unsupported" });
    assert.deepEqual(crypto.openVaultEntry(entry("e", { ...sealed, wrappedKey: sealed.wrappedKey.replace(/^b1:/, "b2:") })), { ok: false, reason: "unsupported" });
    assert.deepEqual(crypto.openVaultEntry(entry("e", { ...sealed, wrappedKey: null as never })), { ok: false, reason: "empty" });
    assert.deepEqual(crypto.openVaultEntry(entry("e", { ...sealed, payload: null as never })), { ok: false, reason: "empty" });
  });

  it("IV und Eintragsschlüssel sind je Verschlüsselung neu: 500 Mal dieselben Daten ergeben 500 verschiedene IVs, Schlüssel und Blöcke", () => {
    const ivs = new Set<string>();
    const wraps = new Set<string>();
    const blocks = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const sealed = crypto.sealVaultEntry("same", 1, LABEL, markSecret());
      ivs.add(sealed.payload.split(":")[1]);
      wraps.add(sealed.wrappedKey);
      blocks.add(sealed.payload);
    }
    assert.deepEqual([ivs.size, wraps.size, blocks.size], [500, 500, 500]);
  });

  it("ein echter (GCM-geprüfter) Block mit unerwarteter Form oder zu langen Feldern ist „nicht unterstützt“, nicht beschädigt und nicht lesbar", () => {
    // ein selbst gebauter, gültig verschlüsselter Block mit falschem Inhalt (wie ihn eine andere Programmversion schriebe)
    const build = (content: unknown) => {
      const dek = randomBytes(32);
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", dek, iv);
      const digest = createHash("sha256").update(JSON.stringify([LABEL.title, LABEL.kind, LABEL.system])).digest("hex").slice(0, 32);
      cipher.setAAD(Buffer.from(`schrauberos:vault:payload:v1:z:1:${digest}`));
      const data = Buffer.concat([cipher.update(JSON.stringify(content)), cipher.final()]);
      const payload = ["p1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
      return { id: "z", ...LABEL, format: 1, revision: 1, wrappedKey: secrets.encryptSecretBound(dek, "schrauberos:vault:dek:v1:z"), payload };
    };
    assert.deepEqual(crypto.openVaultEntry(build({ url: 1, username: "x" })), { ok: false, reason: "unsupported" });
    assert.deepEqual(crypto.openVaultEntry(build({ url: "u", username: "n", secret: "s".repeat(2001), note: "" })), { ok: false, reason: "unsupported" });
    assert.deepEqual(crypto.openVaultEntry(build(null)), { ok: false, reason: "unsupported" });
    assert.equal(crypto.openVaultEntry(build({ url: "u", username: "n", secret: "s", note: "" })).ok, true, "die Bauart stimmt");
  });

  it("GCM-Tag und IV sind festgenagelt: ein auf 4 Byte gekürzter (sonst korrekter) Tag, eine zu kurze IV und unkanonisches Base64 öffnen nie – weder Block noch umhüllter Schlüssel", () => {
    const sealed = crypto.sealVaultEntry("e", 1, LABEL, markSecret());
    const withPart = (blob: string, index: number, mutate: (part: string) => string) => {
      const parts = blob.split(":");
      parts[index] = mutate(parts[index]);
      return parts.join(":");
    };
    const truncate = (part: string) => Buffer.from(part, "base64").subarray(0, 4).toString("base64");
    // Block: gekürzter Tag, gekürzte IV
    assert.deepEqual(crypto.openVaultEntry(entry("e", { ...sealed, payload: withPart(sealed.payload, 2, truncate) })), { ok: false, reason: "damaged" });
    assert.deepEqual(crypto.openVaultEntry(entry("e", { ...sealed, payload: withPart(sealed.payload, 1, (p) => Buffer.from(p, "base64").subarray(0, 8).toString("base64")) })), { ok: false, reason: "damaged" });
    // Block: Leerraum, URL-sicheres Alphabet, fehlende Auffüllung, Fremdzeichen
    const data = sealed.payload.split(":")[3];
    for (const mutate of [
      (p: string) => `${p.slice(0, 4)} \n${p.slice(4)}`,
      (p: string) => p.replace(/\+/g, "-").replace(/\//g, "_") + "-",
      (p: string) => p.replace(/=+$/, "") + (p.endsWith("=") ? "" : "A"),
      (p: string) => `${p.slice(0, 4)}!!${p.slice(4)}`,
    ]) {
      assert.deepEqual(crypto.openVaultEntry(entry("e", { ...sealed, payload: withPart(sealed.payload, 3, mutate) })), { ok: false, reason: "damaged" }, mutate(data).slice(0, 12));
    }
    assert.deepEqual(crypto.openVaultEntry(entry("e", { ...sealed, payload: withPart(sealed.payload, 2, (p) => p.replace(/=+$/, "")) })), { ok: false, reason: "damaged" }, "ohne Auffüllung");
    // umhüllter Schlüssel (b1): gekürzter Tag und Fremdzeichen sind keine Form von b1
    assert.equal(secrets.decryptSecretBound(withPart(sealed.wrappedKey, 2, truncate), "schrauberos:vault:dek:v1:e"), null);
    assert.deepEqual(crypto.openVaultEntry(entry("e", { ...sealed, wrappedKey: withPart(sealed.wrappedKey, 2, truncate) })), { ok: false, reason: "damaged" });
    assert.deepEqual(crypto.openVaultEntry(entry("e", { ...sealed, wrappedKey: withPart(sealed.wrappedKey, 3, (p) => `${p} `) })), { ok: false, reason: "damaged" });
    // v1-Geheimnisse der Einstellungen und die Hülle des Wiederherstellungsschlüssels: dieselbe Regel
    const v1 = secrets.encryptSecret("geheim");
    assert.equal(secrets.decryptSecret(v1), "geheim");
    assert.equal(secrets.decryptSecret(withPart(v1, 2, truncate)), null, "v1: Tag 4 Byte");
    assert.equal(secrets.decryptSecret(`${v1}:extra`), null, "v1: fünf Teile");
  });
});

describe("Rechte: auch Administratoren nur ausdrücklich", () => {
  it("ein Administrator ohne ausdrückliches Recht hat den Tresor nicht (Sitzung, Seiten, Aktionen) – mit zusätzlicher Rolle schon", async () => {
    const { getSession } = await import("@/server/auth/session");
    const entry = await makeEntry();
    await login([], { admin: true });
    let session = (await getSession())!;
    assert.equal(session.user.isAdmin, true);
    assert.ok(session.can("users.manage") && session.can("docsIt.edit"), "alle übrigen Rechte hat er");
    assert.equal(session.can("docsIt.vault"), false);
    assert.equal(session.can("docsIt.vaultManage"), false);
    assert.equal(await redirectOf(() => reveal(entry.id)), "/forbidden");
    assert.equal(await redirectOf(() => save()), "/forbidden");
    assert.equal(await redirectOf(() => actions.deleteVaultEntry(form({ id: entry.id }))), "/forbidden");
    assert.equal(await env.db.vaultEntry.count(), 1);

    env.signOut();
    await login([], { admin: true, extra: ["docsIt.vault"] });
    session = (await getSession())!;
    assert.deepEqual([session.can("docsIt.vault"), session.can("docsIt.vaultManage")], [true, false]);
    assert.equal((await reveal(entry.id)).ok, true);
    assert.equal(await redirectOf(() => save({ title: "Neu" })), "/forbidden", "ansehen genügt nicht zum Verwalten");
  });

  it("Ansehen und Verwalten sind getrennt – und Verwalten setzt Ansehen voraus", async () => {
    const entry = await makeEntry();
    await login(["docsIt.vaultManage"]);
    const state = await save({ title: "Blind" });
    assert.ok(state.error, "wer nur verwalten darf, ändert nichts blind");
    assert.equal(await env.db.vaultEntry.count(), 1);
    await redirectOf(() => actions.deleteVaultEntry(form({ id: entry.id, password: PASSWORD })));
    assert.equal(await env.db.vaultEntry.count(), 1, "wer nur verwalten darf, löscht nichts blind");
    env.signOut();
    await login(["docsIt.vault", "docsIt.edit", "docsIt.view"]);
    assert.equal(await redirectOf(() => save({ title: "Zu wenig" })), "/forbidden");
  });

  it("ohne Anmeldung gibt es nichts", async () => {
    const entry = await makeEntry();
    env.signOut();
    assert.equal(await redirectOf(() => reveal(entry.id)), "/login");
    assert.equal(await redirectOf(() => save()), "/login");
  });

  it("die Rechte sind gekennzeichnet, in keiner Standardrolle, in keinem Token und in keinem Rollenvorlagen-Vorschlag", async () => {
    const { MARKED_PERMISSIONS, isExplicitOnly } = await import("@/modules/catalog");
    const { DEFAULT_ROLES } = await import("@/modules/default-roles");
    const { isApiForbidden } = await import("@/lib/api/scope");
    assert.equal(MARKED_PERMISSIONS.get("docsIt.vault"), "reveal");
    assert.equal(MARKED_PERMISSIONS.get("docsIt.vaultManage"), "sensitive");
    for (const p of BOTH) {
      assert.ok(isExplicitOnly(p) && isApiForbidden(p), p);
      for (const role of DEFAULT_ROLES) assert.ok(!(role.permissions as readonly string[]).includes(p), `${role.key}: ${p}`);
    }
  });
});

describe("Anlegen, Ändern, Löschen", () => {
  it("Anlegen verschlüsselt: in der Datenbank steht nichts im Klartext, das Audit nennt Titel und „Zugangsdaten“, nie Inhalt", async () => {
    await login(BOTH);
    const target = await redirectOf(() => save());
    const row = await env.db.vaultEntry.findFirstOrThrow();
    assert.equal(target, `/docs/vault/${row.id}`);
    assert.deepEqual([row.title, row.kind, row.system, row.revision, row.format, row.unreadableAt], ["Firewall", "network", "fw-01", 1, 1, null]);
    assert.ok(row.wrappedKey && row.payload);
    assertNoPlaintext(dumpDatabase(), "Datenbank");
    assert.deepEqual(await audits(), ["vault.create Firewall · Zugangsdaten"]);
    assert.equal((await env.db.auditLog.findFirstOrThrow()).entityId, row.id);
    // Rundlauf über die Anzeige
    const shown = await reveal(row.id);
    assert.deepEqual((shown as { vault?: unknown }).vault, { title: "Firewall", ...MARK });
  });

  it("ohne Zugangsdaten entsteht ein leerer Eintrag (nichts verschlüsselt); Titel, Art und Grenzen werden geprüft", async () => {
    await login(BOTH);
    assert.ok(await redirectOf(() => save({ url: undefined, username: undefined, secret: undefined, note: undefined })));
    const row = await env.db.vaultEntry.findFirstOrThrow();
    assert.deepEqual([row.wrappedKey, row.payload, row.unreadableAt], [null, null, null]);
    assert.equal((await queries.getVaultEntry(row.id))?.state, "empty");
    assert.ok((await save({ title: "" })).fieldErrors?.title);
    assert.ok((await save({ kind: "toaster" })).fieldErrors?.kind);
    assert.ok((await save({ secret: "x".repeat(2001) })).fieldErrors?.secret);
    assert.ok((await save({ url: "u".repeat(301) })).fieldErrors?.url);
    assert.equal(await env.db.vaultEntry.count(), 1);
  });

  it("Ändern ohne neue Zugangsdaten rührt den verschlüsselten Block nicht an (Revision, Schlüssel und Block bleiben)", async () => {
    await login(BOTH);
    await redirectOf(() => save());
    const before = await env.db.vaultEntry.findFirstOrThrow();
    // gleiche Beschriftung, keine neuen Zugangsdaten: der Block bleibt, wie er ist
    assert.ok(await redirectOf(() => save({ id: before.id, version: versionOf(before), url: undefined, username: undefined, secret: undefined, note: undefined, password: undefined })));
    const after = await env.db.vaultEntry.findUniqueOrThrow({ where: { id: before.id } });
    assert.deepEqual([after.title, after.system, after.revision, after.wrappedKey, after.payload], ["Firewall", "fw-01", 1, before.wrappedKey, before.payload]);
    assert.deepEqual(await audits(), ["vault.create Firewall · Zugangsdaten", "vault.update Firewall"]);
  });

  it("Umbenennen verschlüsselt neu (Titel, Art und System sind mit dem Block verbunden): Revision + 1, neuer Block, derselbe Inhalt – ohne Passwortabfrage", async () => {
    await login(BOTH);
    await redirectOf(() => save());
    const before = await env.db.vaultEntry.findFirstOrThrow();
    assert.ok(await redirectOf(() => save({ id: before.id, version: versionOf(before), title: "Firewall neu", system: "fw-02", kind: "server", url: undefined, username: undefined, secret: undefined, note: undefined, password: undefined })));
    const after = await env.db.vaultEntry.findUniqueOrThrow({ where: { id: before.id } });
    assert.deepEqual([after.title, after.system, after.kind, after.revision], ["Firewall neu", "fw-02", "server", 2]);
    assert.notEqual(after.payload, before.payload);
    assert.deepEqual(await audits(), ["vault.create Firewall · Zugangsdaten", "vault.update Firewall neu"]);
    assert.deepEqual(((await reveal(before.id)) as { vault?: Record<string, string> }).vault, { title: "Firewall neu", ...MARK });
  });

  it("Ändern mit neuen Zugangsdaten: neue IV und neuer Schlüssel, Revision + 1; leere Felder behalten ihren Wert, „Entfernen“ leert ihn", async () => {
    await login(BOTH);
    await redirectOf(() => save());
    const first = await env.db.vaultEntry.findFirstOrThrow();
    // nur das Passwort ändern: URL, Benutzername und Notiz bleiben
    assert.ok(await redirectOf(() => save({ id: first.id, version: versionOf(first), url: undefined, username: undefined, note: undefined, secret: "neues-Passwort-1" })));
    const second = await env.db.vaultEntry.findUniqueOrThrow({ where: { id: first.id } });
    assert.equal(second.revision, 2);
    assert.notEqual(second.payload, first.payload);
    assert.notEqual(second.wrappedKey, first.wrappedKey);
    assert.notEqual(second.payload!.split(":")[1], first.payload!.split(":")[1], "neue IV");
    let shown = (await reveal(first.id)) as { vault?: Record<string, string> };
    assert.deepEqual(shown.vault, { title: "Firewall", url: MARK.url, username: MARK.username, secret: "neues-Passwort-1", note: MARK.note });
    // Notiz und Benutzername entfernen
    assert.ok(await redirectOf(() => save({ id: first.id, version: versionOf(second), url: undefined, username: undefined, note: undefined, secret: undefined, clearNote: true, clearUsername: true })));
    shown = (await reveal(first.id)) as { vault?: Record<string, string> };
    assert.deepEqual(shown.vault, { title: "Firewall", url: MARK.url, username: "", secret: "neues-Passwort-1", note: "" });
    const third = await env.db.vaultEntry.findUniqueOrThrow({ where: { id: first.id } });
    assert.equal(third.revision, 3);
    // alles entfernen → leerer Eintrag
    assert.ok(await redirectOf(() => save({ id: first.id, version: versionOf(third), url: undefined, username: undefined, note: undefined, secret: undefined, clearUrl: true, clearSecret: true })));
    const empty = await env.db.vaultEntry.findUniqueOrThrow({ where: { id: first.id } });
    assert.deepEqual([empty.wrappedKey, empty.payload], [null, null]);
    assertNoPlaintext(dumpDatabase(), "Datenbank");
  });

  it("gleichzeitiges Bearbeiten: eine veraltete Version überschreibt nichts", async () => {
    await login(BOTH);
    await redirectOf(() => save());
    const row = await env.db.vaultEntry.findFirstOrThrow();
    const stale = versionOf(row);
    assert.ok(await redirectOf(() => save({ id: row.id, version: stale, title: "A", url: undefined, username: undefined, secret: undefined, note: undefined })));
    assert.ok((await save({ id: row.id, version: stale, title: "B" })).error);
    assert.equal((await env.db.vaultEntry.findUniqueOrThrow({ where: { id: row.id } })).title, "A");
    assert.ok((await save({ id: "gibt-es-nicht", version: stale })).error);
  });

  it("Löschen ist endgültig und steht im Audit-Log (Titel, nie Inhalt)", async () => {
    await login(BOTH);
    const entry = await makeEntry("Router Büro");
    assert.equal(await redirectOf(() => actions.deleteVaultEntry(form({ id: entry.id, password: PASSWORD }))), "/docs/vault");
    assert.equal(await env.db.vaultEntry.count(), 0);
    assert.deepEqual(await audits(), ["vault.delete Router Büro"]);
    // ein zweites Mal: es gibt nichts mehr – zurück zur Seite des Eintrags mit Meldung, kein Fehler
    assert.ok(await redirectOf(() => actions.deleteVaultEntry(form({ id: entry.id, password: PASSWORD }))));
  });

  it("Löschen und Ändern der hinterlegten Zugangsdaten verlangen das eigene Passwort (gleiches Limit wie das Anzeigen): ohne und mit falschem Passwort bleibt alles, wie es war", async () => {
    await login(BOTH);
    const entry = await makeEntry("Router");
    const row = () => env.db.vaultEntry.findUniqueOrThrow({ where: { id: entry.id } });
    // Löschen
    await redirectOf(() => actions.deleteVaultEntry(form({ id: entry.id })));
    await redirectOf(() => actions.deleteVaultEntry(form({ id: entry.id, password: "falsch" })));
    assert.equal(await env.db.vaultEntry.count(), 1, "nicht gelöscht");
    // Ersetzen, Ergänzen, Leeren der Zugangsdaten
    for (const fields of [{ secret: "Koeder-Pw-1" }, { username: "koeder" }, { clearSecret: true }, { clearNote: true }]) {
      const current = await row();
      const base = { id: entry.id, version: versionOf(current), title: "Router", url: undefined, username: undefined, note: undefined, secret: undefined, ...fields };
      const without = await save({ ...base, password: undefined });
      assert.ok(without.fieldErrors?.password, `ohne Passwort: ${JSON.stringify(fields)}`);
      const wrong = await save({ ...base, password: "falsch" });
      assert.ok(wrong.fieldErrors?.password, `falsches Passwort: ${JSON.stringify(fields)}`);
    }
    const unchanged = await row();
    assert.deepEqual([unchanged.payload, unchanged.wrappedKey, unchanged.revision], [entry.payload, entry.wrappedKey, entry.revision], "Block unverändert");
    // dieselben Fehlversuche zählen im Limit des Anzeigens: nach fünf ist auch das richtige Passwort eine Weile zu
    const blocked = (await reveal(entry.id)) as { error?: string; fieldErrors?: unknown };
    assert.ok(blocked.error ?? blocked.fieldErrors, "gemeinsames Limit");
    assert.equal((blocked as { vault?: unknown }).vault, undefined);
    // nach Ablauf der Wartezeit geht Löschen mit dem richtigen Passwort
    throttle.resetLoginThrottle();
    assert.equal(await redirectOf(() => actions.deleteVaultEntry(form({ id: entry.id, password: PASSWORD }))), "/docs/vault");
    assert.equal(await env.db.vaultEntry.count(), 0);
  });

  it("erstmaliges Eintragen von Zugangsdaten in einen Eintrag ohne Zugangsdaten braucht kein Passwort (es ersetzt nichts)", async () => {
    await login(BOTH);
    await redirectOf(() => save({ url: undefined, username: undefined, secret: undefined, note: undefined }));
    const row = await env.db.vaultEntry.findFirstOrThrow();
    assert.ok(await redirectOf(() => save({ id: row.id, version: versionOf(row), password: undefined })));
    assert.equal((await queries.getVaultEntry(row.id))?.state, "sealed");
  });
});

describe("Ändern überschreibt nie einen rettbaren oder unbekannten Block", () => {
  const row = (id: string) => env.db.vaultEntry.findUniqueOrThrow({ where: { id } });
  const edit = async (id: string, fields: Record<string, string | number | boolean | undefined> = {}) =>
    save({ id, version: versionOf(await row(id)), title: "Firewall", url: undefined, username: undefined, secret: undefined, note: undefined, ...fields });

  it("Probe P2: fremder, noch nicht zurückgesetzter Schlüssel – eine Teiländerung überschreibt den alten Block nicht (er bleibt mit dem richtigen Schlüssel lesbar)", async () => {
    await login(BOTH);
    const original = readFileSync(keyPath(), "utf8");
    const entry = await makeEntry();
    writeKey(); // fremder Schlüssel (anderes Volume), keine Hülle: kein Schlüsselproblem, aber der Block gehört nicht dazu
    assert.deepEqual(crypto.openVaultEntry(await row(entry.id)), { ok: false, reason: "unreadable" });
    const partial = await edit(entry.id, { username: "nur-ein-neuer-user" });
    assert.ok(partial.error, "Teiländerung abgelehnt");
    const rename = await edit(entry.id, { title: "Umbenannt", password: PASSWORD });
    assert.ok(rename.error, "auch Umbenennen schreibt den Block neu und wird abgelehnt");
    const unchanged = await row(entry.id);
    assert.deepEqual([unchanged.payload, unchanged.wrappedKey, unchanged.revision, unchanged.title], [entry.payload, entry.wrappedKey, entry.revision, "Firewall"]);
    writeKey(original);
    assert.deepEqual(crypto.openVaultEntry(await row(entry.id)), { ok: true, secret: markSecret() }, "mit dem richtigen Schlüssel noch lesbar");
  });

  it("nicht lesbarer Block ohne Schlüsselstörung: nur eine vollständige Neueingabe aller vier Felder (mit Passwort) ersetzt ihn", async () => {
    await login(BOTH);
    const entry = await makeEntry();
    writeKey();
    assert.ok((await edit(entry.id, { url: "https://neu.example", username: "u", secret: "s" })).error, "drei von vier Feldern genügen nicht");
    assert.deepEqual([(await row(entry.id)).payload], [entry.payload]);
    await redirectOf(() => edit(entry.id, { url: "https://neu.example", username: "u", secret: "neues-Pw-9", clearNote: true }));
    const after = await row(entry.id);
    assert.deepEqual(crypto.openVaultEntry(after), { ok: true, secret: { url: "https://neu.example", username: "u", secret: "neues-Pw-9", note: "" } });
    assert.equal(after.revision, 2);
  });

  it("Schlüsselstörung „passt nicht zur Datenbank“ (mismatch): Zugangsdaten anlegen und ändern sind gesperrt, bis der richtige Schlüssel zurück ist; Eintrag ohne Zugangsdaten anlegen geht", async () => {
    await login(BOTH);
    const original = readFileSync(keyPath(), "utf8");
    await recoveryKey.issueRecoveryKey(env.db); // Hülle: der Wiederherstellungsschlüssel könnte alles retten
    const entry = await makeEntry();
    writeKey();
    assert.equal((await issueMod.secretKeyIssue())?.kind, "mismatch");
    // ändern (mit und ohne vollständige Neueingabe), umbenennen
    assert.ok((await edit(entry.id, { username: "neu" })).error);
    assert.ok((await edit(entry.id, { url: "u", username: "n", secret: "s", note: "x" })).error);
    assert.ok((await edit(entry.id, { title: "Umbenannt", password: PASSWORD })).error);
    // neu anlegen: mit Zugangsdaten gesperrt (sie wären nach der Wiederherstellung des richtigen Schlüssels unlesbar), ohne erlaubt
    assert.ok((await save({ title: "Neu mit Zugangsdaten" })).error);
    assert.equal(await env.db.vaultEntry.count({ where: { title: "Neu mit Zugangsdaten" } }), 0, "nichts angelegt");
    assert.ok(await redirectOf(() => save({ title: "Neu leer", url: undefined, username: undefined, secret: undefined, note: undefined })));
    // der alte Block ist unverändert und mit dem richtigen Schlüssel wieder lesbar
    assert.deepEqual([(await row(entry.id)).payload, (await row(entry.id)).wrappedKey], [entry.payload, entry.wrappedKey]);
    writeKey(original);
    assert.deepEqual(crypto.openVaultEntry(await row(entry.id)), { ok: true, secret: markSecret() });
  });

  it("unbekanntes Format (neuere Programmversion): nie überschrieben, auch nicht durch vollständige Neueingabe; beschädigter Block: nur vollständige Neueingabe", async () => {
    await login(BOTH);
    const entry = await makeEntry();
    await env.db.vaultEntry.update({ where: { id: entry.id }, data: { format: 2 } });
    for (const fields of [{ username: "x" }, { url: "u", username: "n", secret: "s", note: "x" }, { title: "Umbenannt" }]) {
      assert.ok((await edit(entry.id, fields)).error, JSON.stringify(fields));
    }
    assert.deepEqual([(await row(entry.id)).payload, (await row(entry.id)).format], [entry.payload, 2]);
    // beschädigt: ein Bit im Chiffrat
    const parts = entry.payload!.split(":");
    const bytes = Buffer.from(parts[3], "base64");
    bytes[0] ^= 1;
    parts[3] = bytes.toString("base64");
    await env.db.vaultEntry.update({ where: { id: entry.id }, data: { format: 1, payload: parts.join(":") } });
    assert.deepEqual(crypto.openVaultEntry(await row(entry.id)), { ok: false, reason: "damaged" });
    assert.ok((await edit(entry.id, { username: "teil" })).error, "Teiländerung abgelehnt");
    await redirectOf(() => edit(entry.id, { url: "u", username: "n", secret: "heil", note: "x" }));
    assert.equal(crypto.openVaultEntry(await row(entry.id)).ok, true);
  });
});

describe("Anzeigen nur mit erneuter Passwortabfrage", () => {
  it("richtiges Passwort: der Klartext steht nur in der Antwort; das Audit nennt Eintrag-ID und Titel, nie Inhalt; kein Ereignis, kein Protokolltext", async () => {
    await login(["docsIt.vault"]);
    const entry = await makeEntry("Router");
    const state = (await reveal(entry.id)) as { ok?: boolean; vault?: Record<string, string> };
    assert.equal(state.ok, true);
    assert.deepEqual(state.vault, { title: "Router", ...MARK });
    assert.deepEqual(await audits(), ["vault.reveal Router"]);
    assert.equal((await env.db.auditLog.findFirstOrThrow()).entityId, entry.id);
    assertNoPlaintext(JSON.stringify(await env.db.auditLog.findMany()), "Audit");
    assertNoPlaintext(dumpDatabase(), "Datenbank");
    assertNoPlaintext(logged.join("\n"), "Log");
    assert.equal(await env.db.outboxEvent.count(), 0, "kein Ereignis für Webhooks");
  });

  it("falsches Passwort: Fehler am Feld, kein Klartext, es zählt (eigenes Limit) – nach fünf Fehlversuchen bleibt auch das richtige Passwort eine Weile zu", async () => {
    const user = await login(["docsIt.vault"]);
    const entry = await makeEntry();
    for (let i = 0; i < 5; i++) {
      const state = (await reveal(entry.id, `falsch-${i}`)) as { fieldErrors?: Record<string, string>; vault?: unknown };
      assert.ok(state.fieldErrors?.password, `Versuch ${i}`);
      assert.equal(state.vault, undefined);
    }
    assert.equal(throttle.loginThrottle.vault.attemptsOf(user.id), 5);
    const blocked = (await reveal(entry.id)) as { error?: string; vault?: unknown };
    assert.ok(blocked.error && blocked.vault === undefined, "gedrosselt, auch mit richtigem Passwort");
    assert.ok(!(await audits()).some((a) => a.startsWith("vault.reveal ")), "nichts angezeigt, nichts als Anzeige protokolliert");
    // nach Ablauf der Wartezeit (Zähler zurück) geht es mit dem richtigen Passwort
    throttle.loginThrottle.vault.clear();
    assert.equal(((await reveal(entry.id)) as { ok?: boolean }).ok, true);
    assert.equal(throttle.loginThrottle.vault.attemptsOf(user.id), 0, "ein Erfolg setzt die Zählung zurück");
  });

  it("falsche Passwörter stehen im Audit-Log (gedrosselt: je Konto höchstens einmal pro Minute), ohne das Eingegebene", async () => {
    await login(["docsIt.vault"]);
    const entry = await makeEntry();
    for (const wrong of ["Geheim-Versuch-1", "Geheim-Versuch-2", "Geheim-Versuch-3"]) await reveal(entry.id, wrong);
    const failed = await env.db.auditLog.findMany({ where: { action: "vault.revealFailed" } });
    assert.equal(failed.length, 1);
    assert.ok(!JSON.stringify(failed).includes("Geheim-Versuch"));
  });

  it("Mengenlimit: nach 30 Anzeigen in kurzer Zeit wartet auch das richtige Passwort", async () => {
    const user = await login(["docsIt.vault"]);
    const entry = await makeEntry();
    for (let i = 0; i < 30; i++) throttle.loginThrottle.vaultReveal.take(user.id);
    assert.ok(throttle.loginThrottle.vaultReveal.check(user.id) > 0, "Wartezeit läuft");
    const state = (await reveal(entry.id)) as { error?: string; vault?: unknown };
    assert.ok(state.error && state.vault === undefined);
  });

  it("der Antwort-Weg: Aktion nur per POST (Server Action) – die Seite und die Abfragen enthalten nie Zugangsdaten oder verschlüsselte Spalten", async () => {
    const entry = await makeEntry();
    const detail = await queries.getVaultEntry(entry.id);
    const list = await queries.listVaultEntries();
    for (const value of [detail, list]) {
      const json = JSON.stringify(value);
      assertNoPlaintext(json, "Abfrage");
      assert.ok(!/wrappedKey|payload/.test(json), "keine verschlüsselten Spalten");
    }
    assert.deepEqual(Object.keys(list[0]).sort(), ["id", "kind", "state", "system", "title", "updatedAt", "updatedByName"], "Liste: nur Titel, Art, System, Zustand");
    // die Seitendateien lesen die Tabelle nicht selbst und rufen nur Anzeige-Aktion und Abfragen auf
    const page = readFileSync(path.resolve("src/app/(app)/docs/vault/[id]/page.tsx"), "utf8");
    assert.ok(!/db\.vaultEntry|openVaultEntry|payload|wrappedKey/.test(page));
  });

  it("nicht vorhandener, leerer, nicht lesbarer und beschädigter Eintrag: jeweils eine eigene Meldung, nie Klartext", async () => {
    await login(["docsIt.vault"]);
    assert.ok(((await reveal("gibt-es-nicht")) as { error?: string }).error);
    const empty = await env.db.vaultEntry.create({ data: { title: "Leer" } });
    assert.ok(((await reveal(empty.id)) as { error?: string }).error);
    const damaged = await makeEntry("Kaputt");
    await env.db.vaultEntry.update({ where: { id: damaged.id }, data: { revision: 7 } });
    const state = (await reveal(damaged.id)) as { error?: string; vault?: unknown };
    assert.ok(state.error && state.vault === undefined);
    const messages = new Set<string | undefined>([((await reveal(empty.id)) as { error?: string }).error, state.error]);
    assert.equal(messages.size, 2, "verschiedene Meldungen");
  });
});

describe("Klartext nirgends sonst", () => {
  it("weder Suche noch API-Ressourcen noch Webhook-Ereignisse noch CSV kennen den Tresor", async () => {
    const { getSession } = await import("@/server/auth/session");
    const { searchFor } = await import("@/modules/registry");
    const { apiEndpoints } = await import("@/modules/api");
    const { WEBHOOK_EVENTS } = await import("@/modules/catalog");
    const { EXPORTS, IMPORTS } = await import("@/modules/exchange");
    const { checkTokenScope } = await import("@/lib/api/scope");
    await login([...BOTH, "docsIt.view", "docsIt.edit"], { admin: true });
    await makeEntry("Marker-Tresor-Titel");
    const session = (await getSession())!;
    const groups = await searchFor(session, "Marker");
    assert.ok(!JSON.stringify(groups).includes("Marker-Tresor-Titel"), "Schnellsuche");
    assert.ok(!JSON.stringify(await searchFor(session, MARK.secret)).includes("Tresor"));
    assert.deepEqual(apiEndpoints.filter((e) => /vault/i.test(`${e.path} ${e.operations.join(" ")} ${e.permission}`)).map((e) => e.operationId), []);
    assert.equal(checkTokenScope({ rights: new Set(BOTH) }, ["docsIt.vault"]), "forbidden");
    assert.equal(checkTokenScope({ rights: new Set(BOTH) }, ["docsIt.vaultManage"]), "forbidden");
    assert.deepEqual(WEBHOOK_EVENTS.filter((e) => /vault/i.test(`${e.type} ${e.resource}`)), []);
    assert.deepEqual([...EXPORTS, ...IMPORTS].filter((d) => /vault/i.test(JSON.stringify([d.id, d.feature, d.permission]))), []);
    // der Versionsverlauf der Dokumentation bleibt unberührt
    assert.equal(await env.db.docVersion.count(), 0);
  });

  it("Seiten unter /docs/vault werden nie zwischengespeichert (Cache-Control: no-store über den Proxy)", async () => {
    const { isNoStorePath } = await import("@/lib/no-store");
    assert.deepEqual(["/docs/vault", "/docs/vault/abc", "/docs/vault/abc/edit", "/docs/vault/new"].map(isNoStorePath), [true, true, true, true]);
    assert.deepEqual(["/docs/it", "/docs/vaults", "/docs", "/network"].map(isNoStorePath), [false, false, false, false]);
  });

  it("Demo-Seed: ein Beispiel-Eintrag ohne Zugangsdaten, ohne secret.key anzufassen", async () => {
    const { seeds } = await import("./seed");
    const def = seeds.find((s) => s.id === "vault")!;
    const before = readFileSync(keyPath(), "utf8");
    await def.demo!(env.db);
    await def.demo!(env.db);
    const rows = await env.db.vaultEntry.findMany();
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].wrappedKey, rows[0].payload, rows[0].kind], [null, null, "network"]);
    assert.equal(readFileSync(keyPath(), "utf8"), before);
  });
});

describe("Zustände von secret.key", () => {
  it("Datei fehlt: kein neuer Schlüssel (der Tresor hält Geheimnisse), alles bleibt gesperrt – Anzeigen, Anlegen, Ändern; nichts wird gelöscht oder zurückgesetzt", async () => {
    await login(BOTH);
    const entry = await makeEntry();
    rmSync(keyPath());
    assert.equal(secrets.databaseHoldsSecrets(), true, "Einträge mit umhülltem Schlüssel gelten als Geheimnisse");
    assert.equal(secrets.ensureSecretKey().state, "missing");
    assert.equal(existsSync(keyPath()), false, "nie still ein neuer Schlüssel");
    assert.deepEqual(await issueMod.secretKeyIssue(), { kind: "missing", recoverable: false });
    assert.throws(() => crypto.openVaultEntry(entry), secrets.SecretKeyUnavailableError);
    assert.throws(() => crypto.sealVaultEntry("x", 1, { title: "x", kind: "other", system: null }, markSecret()), secrets.SecretKeyUnavailableError);
    assert.ok(((await reveal(entry.id)) as { error?: string }).error, "Anzeigen gesperrt");
    assert.ok((await save({ title: "Neu" })).error, "Anlegen gesperrt");
    assert.ok((await save({ id: entry.id, version: versionOf(entry), secret: "neu-1" })).error, "Ändern der Zugangsdaten gesperrt");
    // auch das Umbenennen verschlüsselt neu (Beschriftung und Block sind verbunden) und braucht den Schlüssel
    assert.ok((await save({ id: entry.id, version: versionOf(entry), title: "Nur umbenannt", url: undefined, username: undefined, secret: undefined, note: undefined, password: undefined })).error, "Umbenennen gesperrt");
    assert.deepEqual(await secretReset.resetUnreadableSecrets(), [], "ohne Schlüssel wird nichts zurückgesetzt");
    const row = await env.db.vaultEntry.findUniqueOrThrow({ where: { id: entry.id } });
    assert.deepEqual([row.wrappedKey, row.payload, row.unreadableAt === null], [entry.wrappedKey, entry.payload, true], "unverändert");
    assert.equal(await env.db.vaultEntry.count(), 1);
    // ohne Änderung an der Beschriftung (nur „gespeichert“) geht es auch ohne Schlüssel: der Block bleibt unberührt
    assert.ok(await redirectOf(() => save({ id: entry.id, version: versionOf(row), url: undefined, username: undefined, secret: undefined, note: undefined, password: undefined })));
  });

  it("Datei nicht lesbar (Verzeichnis statt Datei): gesperrt, nie überschrieben, nie zurückgesetzt", async () => {
    const entry = await makeEntry();
    rmSync(keyPath());
    mkdirSync(keyPath());
    assert.throws(() => crypto.openVaultEntry(entry), secrets.SecretKeyUnavailableError);
    assert.deepEqual(await secretReset.resetUnreadableSecrets(), []);
    assert.equal((await env.db.vaultEntry.findUniqueOrThrow({ where: { id: entry.id } })).wrappedKey, entry.wrappedKey);
    rmSync(keyPath(), { recursive: true });
  });

  it("Wiederherstellung MIT Wiederherstellungsschlüssel: secret.key kommt aus der Hülle zurück, der Tresor ist wieder lesbar", async () => {
    await login(["docsIt.vault"]);
    const original = readFileSync(keyPath(), "utf8");
    const key = await recoveryKey.issueRecoveryKey(env.db);
    const entry = await makeEntry();
    rmSync(keyPath()); // neuer Datenträger: nur Datenbank und Backup sind da
    assert.ok(((await reveal(entry.id)) as { error?: string }).error);
    assert.deepEqual(await recoveryMod.reconstructSecretKey(key), { ok: true });
    assert.equal(readFileSync(keyPath(), "utf8"), original);
    assert.deepEqual(((await reveal(entry.id)) as { vault?: Record<string, string> }).vault, { title: "Firewall", ...MARK });
  });

  it("Wiederherstellung OHNE Schlüssel (fremder secret.key): erst ein falscher Schlüssel macht nichts kaputt; zurückgesetzt wird erst auf ausdrückliche Wiederherstellung – nach Sicherung der Zeilen", async () => {
    await login(["docsIt.vault", "docsIt.vaultManage"]);
    const original = readFileSync(keyPath(), "utf8");
    const one = await makeEntry("Eins", markSecret());
    const two = await makeEntry("Zwei", { ...markSecret(), secret: "Zweites-Pw-77" });
    const empty = await env.db.vaultEntry.create({ data: { title: "Leer" } });

    writeKey(); // fremder Schlüssel (anderes Volume)
    assert.deepEqual(crypto.openVaultEntry(one), { ok: false, reason: "unreadable" });
    assert.ok(((await reveal(one.id)) as { error?: string }).error);
    assert.equal(await env.db.vaultEntry.count(), 3, "nichts ist verloren");
    // der alte Schlüssel kommt zurück → alles lesbar (nichts wurde zerstört)
    const foreign = readFileSync(keyPath(), "utf8");
    writeKey(original);
    assert.equal(crypto.openVaultEntry(one).ok, true);
    writeKey(foreign);

    // ein Eintrag, der mit dem neuen Schlüssel angelegt wurde, ist lesbar und bleibt unberührt
    const fresh = await makeEntry("Neu", { ...markSecret(), secret: "Neues-Pw-5" });

    const items = await secretReset.resetUnreadableSecrets();
    assert.deepEqual(items, [{ id: "it.vault", count: 2 }]);
    const rows = await env.db.vaultEntry.findMany({ orderBy: { title: "asc" } });
    assert.deepEqual(rows.map((r) => [r.title, r.wrappedKey === null, r.payload === null, r.unreadableAt !== null]), [
      ["Eins", true, true, true],
      ["Leer", true, true, false],
      ["Neu", false, false, false],
      ["Zwei", true, true, true],
    ]);
    assert.equal((await queries.getVaultEntry(one.id))?.state, "unreadable");
    assert.equal((await queries.getVaultEntry(empty.id))?.state, "empty");
    assert.equal((await queries.getVaultEntry(fresh.id))?.state, "sealed");
    assert.equal(crypto.openVaultEntry({ ...fresh, wrappedKey: rows.find((r) => r.title === "Neu")!.wrappedKey, payload: rows.find((r) => r.title === "Neu")!.payload }).ok, true);

    // Sicherung der Zeilen VOR dem Zurücksetzen: Datei mit den verschlüsselten Blöcken, kein Klartext
    const files = readdirSync(path.join(env.dir, "secret-reset"));
    assert.equal(files.length, 1);
    const saved = JSON.parse(readFileSync(path.join(env.dir, "secret-reset", files[0]), "utf8")) as { consumers?: Record<string, Array<Record<string, unknown>>> };
    assert.deepEqual(saved.consumers?.["it.vault"]?.map((r) => r.title).sort(), ["Eins", "Zwei"]);
    assert.ok(saved.consumers?.["it.vault"]?.every((r) => typeof r.wrappedKey === "string" && typeof r.payload === "string"));
    assertNoPlaintext(readFileSync(path.join(env.dir, "secret-reset", files[0]), "utf8"), "Sicherung");
    const audit = await env.db.auditLog.findFirstOrThrow({ where: { action: "secrets.reset" } });
    assert.match(audit.target ?? "", /it\.vault: 2/);
    assertNoPlaintext(JSON.stringify(await env.db.auditLog.findMany()), "Audit");

    // „Neu eingeben nötig“: Titel bleiben, die Zugangsdaten werden neu eingegeben
    const row = rows.find((r) => r.title === "Eins")!;
    assert.ok(await redirectOf(() => save({ id: row.id, version: versionOf(row), title: "Eins", url: undefined, username: "neu-user", secret: "neues-Passwort-2", note: undefined, password: undefined })));
    assert.deepEqual(((await reveal(row.id)) as { vault?: Record<string, string> }).vault, { title: "Eins", url: "", username: "neu-user", secret: "neues-Passwort-2", note: "" });
    assert.equal((await queries.getVaultEntry(row.id))?.state, "sealed");
    void two;
  });

  it("Probe P4: nur „fremder Schlüssel“ wird beim Start zurückgesetzt – ein unbekanntes Format (neuere Version, abgesenkte Grenzen) und ein beschädigter Block werden gemeldet, nie zurückgesetzt", async () => {
    const original = readFileSync(keyPath(), "utf8");
    await makeEntry("Lesbar", markSecret());
    const newer = await makeEntry("Neuere Version", markSecret());
    const broken = await makeEntry("Beschädigt", markSecret());
    const lowered = await makeEntry("Abgesenkt", markSecret());
    // neuere Version: Format 2
    await env.db.vaultEntry.update({ where: { id: newer.id }, data: { format: 2 } });
    // beschädigt: ein Bit im Chiffrat
    const parts = broken.payload!.split(":");
    const bytes = Buffer.from(parts[3], "base64");
    bytes[0] ^= 1;
    parts[3] = bytes.toString("base64");
    await env.db.vaultEntry.update({ where: { id: broken.id }, data: { payload: parts.join(":") } });
    // abgesenkte Feldgrenze: der Block ist echt, aber das Geheimnis länger als die Grenze dieses Programms (so schriebe ihn ein Release mit höherer Grenze)
    const huge = crypto.sealVaultEntry(lowered.id, 1, { title: "Abgesenkt", kind: "network", system: "fw-01" }, { ...crypto.EMPTY_SECRET, secret: "y".repeat(2001) });
    await env.db.vaultEntry.update({ where: { id: lowered.id }, data: huge });
    // fremder Schlüssel: der Eintragsschlüssel ist mit einem anderen secret.key umhüllt
    const alien = await env.db.vaultEntry.create({ data: { title: "Fremder Schlüssel", kind: "other" } });
    writeKey();
    const alienSealed = crypto.sealVaultEntry(alien.id, 1, { title: "Fremder Schlüssel", kind: "other", system: null }, markSecret());
    writeKey(original);
    await env.db.vaultEntry.update({ where: { id: alien.id }, data: alienSealed });

    const read = async (id: string) => crypto.openVaultEntry(await env.db.vaultEntry.findUniqueOrThrow({ where: { id } }));
    assert.deepEqual(await read(alien.id), { ok: false, reason: "unreadable" });
    assert.deepEqual(await read(newer.id), { ok: false, reason: "unsupported" });
    assert.deepEqual(await read(broken.id), { ok: false, reason: "damaged" });
    assert.deepEqual(await read(lowered.id), { ok: false, reason: "unsupported" });

    const items = await secretReset.resetUnreadableSecrets();
    assert.deepEqual(items, [{ id: "it.vault", count: 1 }], "nur der Eintrag mit fremdem Schlüssel");
    const after = await env.db.vaultEntry.findMany();
    const state = (title: string) => after.find((r) => r.title === title)!;
    assert.equal(state("Fremder Schlüssel").wrappedKey, null);
    assert.notEqual(state("Fremder Schlüssel").unreadableAt, null);
    for (const title of ["Neuere Version", "Beschädigt", "Abgesenkt"]) {
      assert.ok(state(title).wrappedKey && state(title).payload, `${title}: Block bleibt`);
      assert.equal(state(title).unreadableAt, null, `${title}: nicht als „Neu eingeben nötig“ markiert`);
    }
    assert.equal(state("Neuere Version").format, 2, "Format unangetastet");
    assert.equal(crypto.openVaultEntry(state("Lesbar")).ok, true, "lesbarer Eintrag unberührt");
    // gemeldet (nur Anzahlen, nie Inhalt oder Titel), und die Sicherung enthält nur den zurückgesetzten Eintrag
    assert.ok(logged.some((line) => /it\.vault: 1 beschädigte und 2 nicht unterstützte/.test(line)), logged.join("\n"));
    const files = readdirSync(path.join(env.dir, "secret-reset"));
    const saved = JSON.parse(readFileSync(path.join(env.dir, "secret-reset", files[0]), "utf8")) as { consumers?: Record<string, Array<Record<string, unknown>>> };
    assert.deepEqual(saved.consumers?.["it.vault"]?.map((r) => r.title), ["Fremder Schlüssel"]);
    assertNoPlaintext(logged.join("\n"), "Protokoll");
  });

  it("scheitert die Sicherung der Zeilen eines Verbrauchers, setzt er nichts zurück (erst sichern, dann zurücksetzen); die übrigen Verbraucher laufen, der Fehler wird gemeldet", async () => {
    const calls: string[] = [];
    const broken = { id: "test.kaputt", resetUnreadable: async () => (calls.push("kaputt"), 3), affectedRows: async (): Promise<Array<Record<string, unknown>>> => Promise.reject(new Error("Datenbank kurz weg")) };
    const fine = { id: "test.heil", resetUnreadable: async () => (calls.push("heil"), 1), affectedRows: async () => [{ id: "x", value: "verschlüsselt" }] };
    const items = await secretReset.resetUnreadableSecrets([broken, fine]);
    assert.deepEqual(calls, ["heil"], "der Verbraucher ohne Sicherung wird übersprungen");
    assert.deepEqual(items, [{ id: "test.heil", count: 1 }]);
    assert.ok(logged.some((line) => /test\.kaputt: die betroffenen Zeilen ließen sich nicht sichern/.test(line)));
    const files = readdirSync(path.join(env.dir, "secret-reset"));
    const saved = JSON.parse(readFileSync(path.join(env.dir, "secret-reset", files[0]), "utf8")) as { consumers?: Record<string, unknown> };
    assert.deepEqual(Object.keys(saved.consumers ?? {}), ["test.heil"]);
    // gibt es sonst nichts zu sichern, bleibt alles (auch für den kaputten Verbraucher) beim Alten
    calls.length = 0;
    rmSync(path.join(env.dir, "secret-reset"), { recursive: true, force: true });
    assert.deepEqual(await secretReset.resetUnreadableSecrets([broken]), []);
    assert.deepEqual(calls, []);
  });

  it("fremder Schlüssel mit vorhandener Hülle (Wiederherstellung wäre möglich): ohne ausdrückliche Wiederherstellung wird nichts zurückgesetzt", async () => {
    const entry = await makeEntry();
    await recoveryKey.issueRecoveryKey(env.db);
    writeKey(); // passt nicht mehr zur Hülle
    assert.equal((await issueMod.secretKeyIssue())?.kind, "mismatch");
    assert.deepEqual(await secretReset.resetUnreadableSecrets(), []);
    assert.equal((await env.db.vaultEntry.findUniqueOrThrow({ where: { id: entry.id } })).wrappedKey, entry.wrappedKey);
    mkdirSync(path.join(env.dir, "restore"), { recursive: true });
    writeFileSync(path.join(env.dir, "restore", "applied.json"), JSON.stringify({ from: "backup", at: "2026-03-10T10:00:00.000Z", files: false }));
    assert.deepEqual(await secretReset.resetUnreadableSecrets(), [{ id: "it.vault", count: 1 }]);
  });

  it("Backup-Schnitt: ein verschlüsselter Eintrag enthält auch im Backup (Kopie der Datenbank) nichts im Klartext; secret.key liegt nicht in der Datenbank", async () => {
    await login(BOTH);
    await redirectOf(() => save());
    const dump = dumpDatabase();
    assertNoPlaintext(dump, "Backup-Inhalt");
    assert.ok(!dump.includes(readFileSync(keyPath(), "utf8")), "der Schlüssel steht nicht in der Datenbank");
  });
});
