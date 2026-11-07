import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { BACKUP_CODE_COUNT, generateBackupCodes, hashBackupCode, NEVER_MATCHING_BACKUP_CODE, normalizeBackupCode } from "@/lib/backup-codes";
import { base32Decode, base32Encode, generateTotpSecret, matchTotp } from "@/lib/totp";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { decryptSecret, encryptSecret, readSecretKey, SecretKeyUnavailableError } from "@/server/secrets";
import { authRuntime } from "./runtime";
import { loginThrottle } from "./throttle";

/**
 * Zweiter Faktor (TOTP) und Sicherungscodes eines Kontos. Alles hier ist **billig** (HMAC/SHA-256, keine Passwortberechnung): Die Prüfung läuft nie über die
 * scrypt-Pfade, sondern ist je Konto gedrosselt (`loginThrottle.totp`, dazu dauerhafte Zähler in der Tabelle, die einen Neustart überstehen).
 *
 *  - Das Geheimnis liegt **verschlüsselt** in der Datenbank (`encryptSecret`: AES-256-GCM, Schlüssel `secret.key` außerhalb der Backups) – nie im Klartext in der
 *    Datenbank, im Log oder im Audit-Log; der Klartext steht nur in der Antwort der Einrichtung (QR-Code und Textschlüssel).
 *  - Ein Code gilt nur einmal: Der zuletzt akzeptierte Zeitschritt steht in `lastStep`, Codes dieses oder eines früheren Schritts werden abgelehnt; das Setzen ist ein
 *    bedingtes Update (zwei gleichzeitige Anmeldungen mit demselben Code: genau eine gewinnt).
 *  - Sicherungscodes sind Einmalcodes (nur als Hash gespeichert, an das Konto gebunden).
 *  - **Restore ohne passenden `secret.key`:** Das Geheimnis ist unlesbar. Die Anmeldung bleibt zu (fail-closed, `secondFactorRequired`); zurückgesetzt wird nur beim Start über
 *    `secret-reset.ts` (`resetUnreadableSecondFactors`: lesbarer Schlüssel, Sicherung der Zeilen, nach einer ausdrücklichen Wiederherstellung bzw. durch die Administration),
 *    bei der nächsten Anmeldung erscheint der Hinweis, und das Audit-Log hält es fest.
 */
type Client = Pick<PrismaClient | Prisma.TransactionClient, "twoFactor" | "twoFactorBackupCode">;
export type ResetReason = "key" | "recovery" | "admin";

/** Nach dieser Ruhezeit beginnt die Fehlversuchs-Zählung eines Kontos von vorn (wie im Speicher: `loginThrottle.totp`). */
const FAILURE_DECAY_MS = 15 * 60_000;

const nowDate = () => new Date(authRuntime.now());

/**
 * Das Geheimnis als Bytes; null, wenn es fehlt, mit einem anderen Schlüssel verschlüsselt wurde **oder der Schlüssel (`secret.key`) gerade nicht lesbar ist** – in allen Fällen
 * lässt sich damit kein Code prüfen (die Anmeldung bleibt zu). Ob etwas zurückgesetzt werden darf, entscheidet nicht diese Funktion (siehe `secret-reset.ts`).
 */
function readSecret(blob: string | null): Buffer | null {
  let plain: string | null = null;
  try {
    plain = blob ? decryptSecret(blob) : null;
  } catch (error) {
    if (!(error instanceof SecretKeyUnavailableError)) throw error;
  }
  return plain ? base32Decode(plain) : null;
}

export type TwoFactorStatus = {
  enabled: boolean;
  enabledAt: Date | null;
  /** Einrichtung begonnen, aber noch nicht bestätigt */
  setupStarted: boolean;
  backupCodesLeft: number;
  resetReason: ResetReason | null;
  resetAt: Date | null;
};

const asReason = (value: string | null): ResetReason | null => (value === "key" || value === "recovery" || value === "admin" ? value : null);

export async function twoFactorStatus(userId: string, client: Client = db): Promise<TwoFactorStatus> {
  const [row, left] = await Promise.all([client.twoFactor.findUnique({ where: { userId } }), client.twoFactorBackupCode.count({ where: { userId, usedAt: null } })]);
  return {
    enabled: !!row?.enabledAt,
    enabledAt: row?.enabledAt ?? null,
    setupStarted: !!row && !row.enabledAt && !!row.secret,
    backupCodesLeft: row?.enabledAt ? left : 0,
    resetReason: asReason(row?.resetReason ?? null),
    resetAt: row?.resetAt ?? null,
  };
}

/**
 * Verlangt die Anmeldung dieses Kontos einen zweiten Faktor? Ja, sobald er eingerichtet ist – **auch wenn das Geheimnis gerade nicht lesbar ist** (`secret.key` fehlt,
 * ist nicht lesbar oder gehört nicht zur Datenbank): Die Anmeldung bleibt dann zu (nur ein Sicherungscode geht, er braucht den Schlüssel nicht), statt sich mit dem Passwort
 * allein zu öffnen. Zurückgesetzt wird hier **nie** etwas – das geschieht ausschließlich beim Start über `secret-reset.ts`, mit Sicherung und nur unter dessen Bedingungen.
 */
export async function secondFactorRequired(userId: string): Promise<boolean> {
  const row = await db.twoFactor.findUnique({ where: { userId }, select: { enabledAt: true } });
  return !!row?.enabledAt;
}

/**
 * Setzt jeden zweiten Faktor zurück, dessen Geheimnis bei **lesbarem** Schlüssel nicht entschlüsselt werden kann (fremder Schlüssel, beschädigt); hält es im Audit-Log fest.
 * Gibt die Zahl der Konten zurück. Nur über `resetUnreadableSecrets` aufrufen (prüft die Bedingungen und sichert vorher die Zeilen); ohne lesbaren Schlüssel tut sie nichts.
 */
export async function resetUnreadableSecondFactors(): Promise<number> {
  if (readSecretKey().state !== "readable") return 0;
  const rows = await db.twoFactor.findMany({ select: { userId: true, secret: true, enabledAt: true } });
  const broken = rows.filter((row) => (row.enabledAt || row.secret) && !readSecret(row.secret));
  if (broken.length === 0) return 0;
  await db.$transaction(async (tx) => {
    for (const row of broken) await resetSecondFactor(tx, row.userId, "key");
    await writeAudit(tx, "auth.twoFactorReset", { actor: { id: null, name: "–" }, target: `${broken.length} Konten · Schlüssel passt nicht (Backup ohne secret.key)` });
  });
  return broken.length;
}

/**
 * Zweiten Faktor eines Kontos zurücksetzen (Administration, Notzugang, fremder Schlüssel): Geheimnis und Sicherungscodes werden gelöscht, die Person sieht einen Hinweis
 * (`resetReason`), bis sie ihn bestätigt. Gibt zurück, ob ein **eingerichteter** zweiter Faktor zurückgesetzt wurde. Läuft in der Transaktion des Aufrufers.
 */
export async function resetSecondFactor(tx: Client, userId: string, reason: ResetReason): Promise<boolean> {
  const row = await tx.twoFactor.findUnique({ where: { userId }, select: { enabledAt: true } });
  if (!row) return false;
  const wasEnabled = !!row.enabledAt;
  await tx.twoFactorBackupCode.deleteMany({ where: { userId } });
  await tx.twoFactor.update({
    where: { userId },
    data: { secret: null, enabledAt: null, lastStep: 0, failedAttempts: 0, lockedUntil: null, resetReason: wasEnabled ? reason : null, resetAt: wasEnabled ? nowDate() : null },
  });
  return wasEnabled;
}

/** Hinweis „zweiter Faktor wurde zurückgesetzt“ als gesehen markieren. */
export async function acknowledgeTwoFactorReset(tx: Client, userId: string): Promise<void> {
  await tx.twoFactor.updateMany({ where: { userId, resetReason: { not: null } }, data: { resetReason: null, resetAt: null } });
}

export type SetupMaterial = { secret: string; codes: string[] };

/**
 * Einrichtung beginnen: neues Geheimnis (verschlüsselt gespeichert, **noch nicht wirksam**) und 10 neue Sicherungscodes. Ein früherer, unbestätigter Versuch wird ersetzt.
 * Ist der zweite Faktor schon eingerichtet, gibt es nichts zu beginnen (`null`). Klartext des Geheimnisses und der Codes: nur in der Antwort der Aktion.
 */
export async function beginSetup(tx: Client, userId: string): Promise<SetupMaterial | null> {
  const existing = await tx.twoFactor.findUnique({ where: { userId }, select: { enabledAt: true } });
  if (existing?.enabledAt) return null;
  const secret = base32Encode(generateTotpSecret());
  const data = { secret: encryptSecret(secret), enabledAt: null, lastStep: 0, failedAttempts: 0, lockedUntil: null };
  await tx.twoFactor.upsert({ where: { userId }, update: data, create: { userId, ...data } });
  return { secret, codes: await replaceBackupCodes(tx, userId) };
}

/** Sicherungscodes ersetzen (alte werden ungültig). Gibt die neuen im Klartext zurück – nur zur einmaligen Anzeige. */
export async function replaceBackupCodes(tx: Client, userId: string): Promise<string[]> {
  const codes = generateBackupCodes(BACKUP_CODE_COUNT);
  await tx.twoFactorBackupCode.deleteMany({ where: { userId } });
  await tx.twoFactorBackupCode.createMany({ data: codes.map((code) => ({ userId, codeHash: hashBackupCode(userId, normalizeBackupCode(code)!) })) });
  return codes;
}

export type ConfirmResult = "ok" | "notStarted" | "wrong";

/** Einrichtung abschließen: der Code aus der App beweist, dass das Geheimnis dort angekommen ist. Erst jetzt verlangt die Anmeldung den zweiten Faktor. */
export async function confirmSetup(tx: Client, userId: string, code: string): Promise<ConfirmResult> {
  const row = await tx.twoFactor.findUnique({ where: { userId } });
  if (!row || row.enabledAt) return "notStarted";
  const secret = readSecret(row.secret);
  if (!secret) return "notStarted";
  const step = matchTotp(secret, code, authRuntime.now());
  if (step === null) return "wrong";
  await tx.twoFactor.update({ where: { userId }, data: { enabledAt: nowDate(), lastStep: step, failedAttempts: 0, lockedUntil: null, resetReason: null, resetAt: null } });
  return "ok";
}

/** Zweiten Faktor ausschalten: Geheimnis, Sicherungscodes und der Hinweis verschwinden. */
export async function disableSecondFactor(tx: Client, userId: string): Promise<boolean> {
  const row = await tx.twoFactor.findUnique({ where: { userId }, select: { enabledAt: true } });
  if (!row) return false;
  await tx.twoFactorBackupCode.deleteMany({ where: { userId } });
  await tx.twoFactor.delete({ where: { userId } });
  return !!row.enabledAt;
}

/* ───────────── Prüfung bei der Anmeldung ───────────── */

export type CheckResult = { ok: true; via: "totp" | "backup"; backupCodesLeft: number } | { ok: false };

/** Verbleibende Wartezeit des Kontos aus der Datenbank (überlebt einen Neustart), in ms. */
export async function secondFactorWaitMs(userId: string): Promise<number> {
  const row = await db.twoFactor.findUnique({ where: { userId }, select: { lockedUntil: true } });
  return row?.lockedUntil ? Math.max(0, row.lockedUntil.getTime() - authRuntime.now()) : 0;
}

/**
 * Prüft den eingegebenen Code: ein Code der App (6 Ziffern, ±1 Zeitschritt, jeder Zeitschritt nur einmal) **oder** ein Sicherungscode (Einmalcode). Beide Wege laufen
 * immer vollständig, egal was eingegeben wurde (gleichförmig, keine Rückschlüsse aus der Dauer), und das Verbrauchen ist ein bedingtes Update (kein doppeltes Einlösen).
 */
export async function checkSecondFactor(userId: string, input: string): Promise<CheckResult> {
  const row = await db.twoFactor.findUnique({ where: { userId } });
  const secret = row?.enabledAt ? readSecret(row.secret) : null;
  const now = authRuntime.now();

  const step = secret ? matchTotp(secret, input, now, { lastStep: row!.lastStep }) : null;
  const normalized = normalizeBackupCode(input);
  const backup = await db.twoFactorBackupCode.findUnique({ where: { codeHash: hashBackupCode(userId, normalized ?? NEVER_MATCHING_BACKUP_CODE) } });

  if (step !== null) {
    const claimed = await db.twoFactor.updateMany({ where: { userId, lastStep: { lt: step } }, data: { lastStep: step, failedAttempts: 0, lockedUntil: null } });
    if (claimed.count === 1) return { ok: true, via: "totp", backupCodesLeft: await db.twoFactorBackupCode.count({ where: { userId, usedAt: null } }) };
  } else if (normalized !== null && backup && backup.userId === userId && backup.usedAt === null && row?.enabledAt) {
    const claimed = await db.twoFactorBackupCode.updateMany({ where: { id: backup.id, usedAt: null }, data: { usedAt: nowDate() } });
    if (claimed.count === 1) {
      await db.twoFactor.updateMany({ where: { userId }, data: { failedAttempts: 0, lockedUntil: null } });
      return { ok: true, via: "backup", backupCodesLeft: await db.twoFactorBackupCode.count({ where: { userId, usedAt: null } }) };
    }
  }
  return { ok: false };
}

/** Einen Fehlversuch beim zweiten Faktor dauerhaft festhalten (wie `User.failedLogins`): Zähler erhöhen, Wartezeit daraus ableiten. */
export async function recordSecondFactorFailure(userId: string): Promise<void> {
  const now = authRuntime.now();
  await db.$transaction(async (tx) => {
    const current = await tx.twoFactor.findUnique({ where: { userId }, select: { failedAttempts: true, lockedUntil: true } });
    if (!current) return;
    const stale = current.lockedUntil !== null && now - current.lockedUntil.getTime() > FAILURE_DECAY_MS;
    const failedAttempts = stale ? 1 : current.failedAttempts + 1;
    const until = now + loginThrottle.totp.delayAfter(failedAttempts);
    await tx.twoFactor.updateMany({ where: { userId }, data: { failedAttempts, lockedUntil: new Date(Math.max(until, current.lockedUntil?.getTime() ?? 0)) } });
  });
}
