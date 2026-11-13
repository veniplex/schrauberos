import "server-only";
import { randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { deriveKek, keyCheck, masterMatches, newMasterKey, recoveryKek, unwrapMaster, validScryptParams, VAULT_SCRYPT, wrapMaster, type ScryptParams } from "@/lib/vault-keys";
import { strictBase64 } from "@/lib/gcm";
import { accountOwner, ownerLane } from "@/server/auth/password";
import { db } from "@/server/db";

/**
 * **Tresor-Hülle** (Plattform; die Einträge und Operationen des Tresors stehen in `modules/it/docs/vault*.ts`): der Hauptschlüssel des IT-Tresors, seine Hüllen in der Datenbank und der Zustand im Prozess.
 *
 *  - **Nur im Speicher:** Der Hauptschlüssel liegt nur im Speicher dieses Prozesses (`memory`; am globalen Objekt, weil der gebaute Server das Modul mehrfach enthält). Nach **jedem Neustart** (auch nach einer
 *    Wiederherstellung und einem Web-Update) ist der Tresor **gesperrt**, bis ein Berechtigter die Passphrase (oder den Wiederherstellungsschlüssel) eingibt. Ein gesperrter Tresor liest und schreibt keine
 *    Zugangsdaten (`VaultLockedError`).
 *  - **Passphrase → Hauptschlüssel:** Der Hauptschlüssel ist zufällig; die Passphrase leitet per scrypt (`VAULT_SCRYPT`, Salz und Kosten im Datensatz) nur den Schlüssel ab, der ihn umhüllt (`lib/vault-keys.ts`).
 *    Die Rechnung läuft im **Eigentümer-Pfad** (`ownerLane`): nie hinter einer Flut von Anmeldungen und je Konto höchstens eine laufende und eine wartende Berechnung.
 *  - **Wiederherstellungsschlüssel:** Wer den Hauptschlüssel im Speicher hat, hinterlegt ihn auch unter einem aus dem Wiederherstellungsschlüssel abgeleiteten Schlüssel (`wrapVaultForRecovery`, aufgerufen von
 *    `issueRecoveryKey`). Ist der Tresor eingerichtet, aber gesperrt, lässt sich **kein neuer Wiederherstellungsschlüssel erzeugen** (er würde den Tresor nicht öffnen) – erst entsperren.
 *  - **Nie stillschweigend zurücksetzen:** Ein Restore ohne passenden `secret.key` berührt den Tresor nicht (er hängt nicht an `secret.key`); nur „Tresor zurücksetzen“ (ausdrücklich, mit Sicherung der Zeilen) verwirft ihn.
 */
export class VaultLockedError extends Error {
  constructor() {
    super("Der Tresor ist gesperrt");
    this.name = "VaultLockedError";
  }
}

type Client = Pick<PrismaClient | Prisma.TransactionClient, "vaultKeyring">;

const shared = globalThis as typeof globalThis & { __sosVault?: { master: Buffer | null; since: Date | null; byName: string | null } };
const memory = (shared.__sosVault ??= { master: null, since: null, byName: null });

/** Kosten der Passphrase-Ableitung; nur Tests dürfen sie senken (scrypt mit 128 MiB je Aufruf macht viele Fälle langsam). */
const costs: { params: ScryptParams; minN: number } = { params: { ...VAULT_SCRYPT }, minN: 2 ** 14 };
export function setVaultScryptForTests(params: ScryptParams | null): void {
  if (!process.env.NODE_TEST_CONTEXT) throw new Error("setVaultScryptForTests: nur in Tests");
  costs.params = params ?? { ...VAULT_SCRYPT };
  costs.minN = params ? 2 ** 8 : 2 ** 14;
}

/** Der Hauptschlüssel für Einträge; wirft `VaultLockedError`, solange der Tresor gesperrt ist. */
export function vaultMasterKey(): Buffer {
  if (!memory.master) throw new VaultLockedError();
  return memory.master;
}

export const isVaultUnlocked = (): boolean => memory.master !== null;

/** Hält den (geprüften) Hauptschlüssel im Speicher: der Tresor ist entsperrt. */
export function unlockVault(master: Buffer, byName: string): void {
  memory.master?.fill(0);
  memory.master = Buffer.from(master);
  memory.since = new Date();
  memory.byName = byName;
}

/** Vergisst den Hauptschlüssel (Sperren, Wiederherstellung, Zurücksetzen). */
export function lockVault(): void {
  memory.master?.fill(0);
  memory.master = null;
  memory.since = null;
  memory.byName = null;
}

export type VaultStatus = { state: "notSetUp" | "locked" | "unlocked"; /** Hülle für den Wiederherstellungsschlüssel vorhanden */ recovery: boolean; unlockedSince: Date | null; unlockedByName: string | null; changedAt: Date | null };

export async function vaultStatus(client: Client = db): Promise<VaultStatus> {
  const row = await client.vaultKeyring.findUnique({ where: { id: "default" }, select: { recoveryWrap: true, updatedAt: true } });
  if (!row) return { state: "notSetUp", recovery: false, unlockedSince: null, unlockedByName: null, changedAt: null };
  return { state: memory.master ? "unlocked" : "locked", recovery: row.recoveryWrap !== null, unlockedSince: memory.since, unlockedByName: memory.byName, changedAt: row.updatedAt };
}

const derive = (passphrase: string, owner: string, salt: Buffer, params: ScryptParams): Promise<Buffer> => ownerLane.run(accountOwner(owner), () => deriveKek(passphrase, salt, params));

/** Die Zeile der Hüllen (Passphrase) – wird **vor** der Transaktion gerechnet (scrypt ist aufwendig), die Operation schreibt sie dann in `run`. */
export type KeyringData = { salt: string; scryptN: number; scryptR: number; scryptP: number; wrappedKey: string };

/** Neue Hülle des Hauptschlüssels unter einer Passphrase (neues Salz, aktuelle Kosten); rechnet im Eigentümer-Pfad des Kontos `userId`. */
export async function buildPassphraseWrap(master: Buffer, passphrase: string, userId: string): Promise<KeyringData> {
  const salt = randomBytes(16);
  const params = { ...costs.params };
  const kek = await derive(passphrase, userId, salt, params);
  try {
    return { salt: salt.toString("base64"), scryptN: params.N, scryptR: params.r, scryptP: params.p, wrappedKey: wrapMaster(master, kek, "passphrase") };
  } finally {
    kek.fill(0);
  }
}

/** Richtet den Tresor ein (Vorbereitung): neuer zufälliger Hauptschlüssel, umhüllt unter der Passphrase. */
export async function buildKeyring(passphrase: string, userId: string): Promise<{ master: Buffer; data: KeyringData }> {
  const master = newMasterKey();
  return { master, data: await buildPassphraseWrap(master, passphrase, userId) };
}

/** Schreibt die Hüllen eines neuen Tresors (in der Transaktion der Operation); `false`, wenn es schon einen gibt. */
export async function createKeyring(client: Client, built: { master: Buffer; data: KeyringData }, byName: string): Promise<boolean> {
  if (await client.vaultKeyring.findUnique({ where: { id: "default" }, select: { id: true } })) return false;
  await client.vaultKeyring.create({ data: { id: "default", ...built.data, check: keyCheck(built.master), createdByName: byName } });
  return true;
}

export type PassphraseOpen = { ok: true; master: Buffer } | { ok: false; reason: "notSetUp" | "wrong" | "invalid" };

/**
 * Öffnet den Hauptschlüssel mit der Passphrase (rechnet im Eigentümer-Pfad des Kontos `userId`). `wrong` = die GCM-Prüfung der Hülle oder der Prüfwert stimmt nicht, `invalid` = der Datensatz ist
 * beschädigt oder trägt unzulässige Kosten (nie rechnen: ein manipulierter Datensatz soll keinen Speicherbedarf auslösen).
 */
export async function openWithPassphrase(client: Client, passphrase: string, userId: string): Promise<PassphraseOpen> {
  const row = await client.vaultKeyring.findUnique({ where: { id: "default" } });
  if (!row) return { ok: false, reason: "notSetUp" };
  const params = { N: row.scryptN, r: row.scryptR, p: row.scryptP };
  const salt = strictBase64(row.salt);
  if (!salt || salt.length < 16 || !validScryptParams(params, costs.minN)) return { ok: false, reason: "invalid" };
  const kek = await derive(passphrase, userId, salt, params);
  try {
    const master = unwrapMaster(row.wrappedKey, kek, "passphrase");
    if (!master) return { ok: false, reason: "wrong" };
    if (!masterMatches(master, row.check)) {
      master.fill(0);
      return { ok: false, reason: "invalid" };
    }
    return { ok: true, master };
  } finally {
    kek.fill(0);
  }
}

/** Öffnet den Hauptschlüssel mit dem Wiederherstellungsschlüssel (Hülle `recoveryWrap`); `null`: keine Hülle oder der Schlüssel passt nicht. */
export async function openWithRecoveryKey(client: Client, recoveryKey: Buffer): Promise<Buffer | null> {
  const row = await client.vaultKeyring.findUnique({ where: { id: "default" }, select: { recoveryWrap: true, check: true } });
  if (!row?.recoveryWrap) return null;
  const master = unwrapMaster(row.recoveryWrap, recoveryKek(recoveryKey), "recovery");
  if (!master) return null;
  if (!masterMatches(master, row.check)) {
    master.fill(0);
    return null;
  }
  return master;
}

/** Passphrase ändern: schreibt die neue Hülle (`buildPassphraseWrap`); der Hauptschlüssel und damit die Einträge bleiben unberührt. */
export async function replacePassphrase(client: Client, data: KeyringData, byName: string): Promise<void> {
  await client.vaultKeyring.update({ where: { id: "default" }, data: { ...data, changedByName: byName } });
}

/** Vor dem Erzeugen eines Wiederherstellungsschlüssels: ist der Tresor eingerichtet und gesperrt, wirft das `VaultLockedError` (der neue Schlüssel würde ihn nicht öffnen). */
export async function assertVaultReadyForRecoveryKey(client: Client): Promise<void> {
  if ((await vaultStatus(client)).state === "locked") throw new VaultLockedError();
}

/** Hinterlegt den Hauptschlüssel unter dem neuen Wiederherstellungsschlüssel (nur bei eingerichtetem, entsperrtem Tresor; sonst nichts zu tun). Ersetzt die bisherige Hülle. */
export async function wrapVaultForRecovery(client: Client, recoveryKey: Buffer): Promise<void> {
  const status = await vaultStatus(client);
  if (status.state === "notSetUp") return;
  const master = vaultMasterKey(); // gesperrt: Fehler (bereits vorab geprüft)
  await client.vaultKeyring.update({ where: { id: "default" }, data: { recoveryWrap: wrapMaster(master, recoveryKek(recoveryKey), "recovery") } });
}

/** Entfernt die Hüllen (ausdrückliches Zurücksetzen des Tresors); danach ist er „nicht eingerichtet“. */
export async function deleteKeyring(client: Client): Promise<void> {
  await client.vaultKeyring.deleteMany({ where: { id: "default" } });
  lockVault();
}
