import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { bytesToDataChars, formatRecoveryCode, parseRecoveryCode } from "@/lib/recovery-code";
import { db } from "@/server/db";
import { hashPassword } from "./password";
import { revokeAccess } from "./revoke";
import { authRuntime } from "./runtime";
import { loginThrottle, normalizeUsername } from "./throttle";

/**
 * Notzugang: Wiederherstellungs-Code für Administrator-Konten. Der Code hat 160 Bit Zufall, gespeichert wird nur sein SHA-256-Hash
 * (bei so viel Zufall genügt ein schneller Hash – Raten ist aussichtslos). Er umgeht Passwort und (später) 2FA und ist deshalb wie
 * ein Passwort aufzubewahren.
 *
 * Das Einlösen läuft über einen **eigenen Pfad** (nicht über die scrypt-Semaphore der Passwortprüfung): SHA-256 und Vergleich in
 * konstanter Zeit über alle gespeicherten Hashes. Gedrosselt wird **ausschließlich global** (Budget, das verlangsamt, nie abweist)
 * und je Client-Adresse (nur mit der Proxy-Einstellung) – **nie pro Konto**, sonst könnte jemand den Notweg lahmlegen.
 * Alle Fehlerfälle (kein Code, falscher Code, Prüfsumme, Konto nicht mehr Administrator/aktiv, bereits benutzt) liefern dieselbe
 * Antwort in derselben Zeit: Jeder Versuch wird auf eine feste, zufällige Dauer aufgefüllt (per Timer, ohne CPU).
 */

/** Feste Mindestdauer eines Einlöse-Versuchs (Erfolg wie Fehlschlag) – deckt das Hashen des neuen Passworts mit ab. */
export const RECOVERY_RESPONSE_MS = { min: 1_200, max: 1_500 } as const;

const sha256hex = (value: string) => createHash("sha256").update(value).digest("hex");
export const recoveryCodeHash = (dataChars: string): string => sha256hex(`schrauberos-recovery-v1:${dataChars}`);

/** Neuer Code: Klartext (nur zur einmaligen Anzeige) und Hash (zum Speichern). */
export function generateRecoveryCode(): { code: string; hash: string } {
  const data = bytesToDataChars(randomBytes(20));
  return { code: formatRecoveryCode(data), hash: recoveryCodeHash(data) };
}

type Tx = Prisma.TransactionClient;

/**
 * Ersetzt den Code des Kontos (legt ihn an oder erneuert ihn); der alte ist danach ungültig. Läuft in der Transaktion des Aufrufers,
 * damit „neuer Code“ und „alter ungültig“ nie auseinanderfallen. Gibt den Klartext zurück.
 */
export async function replaceRecoveryCode(tx: Tx, userId: string): Promise<string> {
  const { code, hash } = generateRecoveryCode();
  await tx.recoveryCode.deleteMany({ where: { userId } });
  await tx.recoveryCode.create({ data: { userId, codeHash: hash } });
  return code;
}

/**
 * Erweiterungsstelle für die Zwei-Faktor-Anmeldung (P1b-5): Beim Einlösen des Codes wird ein eingerichteter zweiter Faktor des
 * Kontos zurückgesetzt. Solange es keine 2FA gibt, ist nichts zu tun – die Stelle ist in der Transaktion des Einlösens bereits
 * verdrahtet und muss dort nur noch gefüllt werden.
 */
export async function resetSecondFactor(tx: Tx, userId: string): Promise<void> {
  void tx;
  void userId;
}

export type RedeemInput = { code: string; password: string; ip: string | null };
export type RedeemResult =
  | { ok: true; newCode: string; account: { id: string; name: string; username: string } }
  /** Immer dieselbe Antwort, egal warum: kein Code, falscher Code, Prüfsumme, Konto unbrauchbar, bereits benutzt */
  | { ok: false; reason: "invalid" }
  /** Nur die Client-Adresse (mit Reverse-Proxy-Einstellung) ist gedrosselt – nie ein Konto */
  | { ok: false; reason: "throttled"; retryAfterSeconds: number };

/** Interner Abbruch für alle Fehlschläge; die Aufrufer sehen nicht, welcher es war. */
class Invalid extends Error {}

/** Auf eine feste Gesamtdauer auffüllen – per Timer, ohne Rechenlast. */
async function padTo(startedAt: number, targetMs: number): Promise<void> {
  await authRuntime.sleep(Math.max(0, targetMs - (authRuntime.now() - startedAt)));
}

function equalHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function redeemRecoveryCode(input: RedeemInput): Promise<RedeemResult> {
  const { budget, ips } = loginThrottle.recovery;

  // 1. Synchron (vor dem ersten await): Adresse prüfen, Versuch belegen, Budget auslesen
  if (input.ip) {
    const wait = ips.check(input.ip);
    if (wait > 0) {
      await authRuntime.sleep(authRuntime.between(RECOVERY_RESPONSE_MS.min, RECOVERY_RESPONSE_MS.max));
      return { ok: false, reason: "throttled", retryAfterSeconds: Math.max(1, Math.ceil(wait / 1000)) };
    }
    ips.take(input.ip);
  }
  const slowdown = budget.delayMs();
  budget.record();

  // 2. Globale Verlangsamung (nie Abweisung), danach beginnt die feste Antwortdauer
  if (slowdown > 0) await authRuntime.sleep(slowdown);
  const startedAt = authRuntime.now();
  const target = authRuntime.between(RECOVERY_RESPONSE_MS.min, RECOVERY_RESPONSE_MS.max);

  let result: RedeemResult;
  try {
    result = await attempt(input);
  } catch (error) {
    if (!(error instanceof Invalid)) {
      await padTo(startedAt, target);
      throw error;
    }
    result = { ok: false, reason: "invalid" };
  }
  await padTo(startedAt, target);

  if (result.ok) {
    budget.release();
    if (input.ip) ips.forgive(input.ip);
  }
  return result;
}

async function attempt(input: RedeemInput): Promise<RedeemResult> {
  const parsed = parseRecoveryCode(input.code);
  // Eine ungültige Eingabe läuft denselben Weg (Hash eines Platzhalters, Vergleich), damit nichts abweicht
  const hash = recoveryCodeHash(parsed.ok ? parsed.data : "0".repeat(32));

  // Vergleich in konstanter Zeit über alle Codes (höchstens so viele wie Administrator-Konten), ohne vorzeitigen Abbruch
  const rows = await db.recoveryCode.findMany({ select: { id: true, userId: true, codeHash: true } });
  let matched: (typeof rows)[number] | null = null;
  for (const row of rows) if (equalHex(row.codeHash, hash) && parsed.ok) matched = row;
  if (!matched) throw new Invalid();
  const found = matched;

  const user = await db.user.findUnique({ where: { id: found.userId }, include: { roles: { include: { role: true } } } });
  if (!user || !user.active || user.authSource !== "local" || !user.roles.some((r) => r.role.isAdmin)) throw new Invalid();

  // Das neue Passwort wird erst jetzt gehasht (nur für einen gültigen Code) – auf dem eigenen Pfad `ownerSemaphore`, nie in der
  // Warteschlange der Anmeldungen; die Antwortdauer ist aufgefüllt
  const passwordHash = await hashPassword(input.password);
  const newCode = await db.$transaction(async (tx) => {
    // Der Code wird verbraucht: nur wer die Zeile tatsächlich löscht, hat ihn eingelöst (zwei gleichzeitige Einlösungen: eine gewinnt)
    const used = await tx.recoveryCode.deleteMany({ where: { id: found.id, codeHash: found.codeHash } });
    if (used.count !== 1) throw new Invalid();
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false, failedLogins: 0, lockedUntil: null } });
    // Zugang verloren: alle Sitzungen enden (kein automatisches Anmelden), bekannte Geräte gelten nicht mehr und API-Tokens des Kontos werden widerrufen
    await revokeAccess(tx, user.id);
    await resetSecondFactor(tx, user.id);
    await tx.recoveryNotice.create({ data: { userId: user.id, userName: user.name } });
    return replaceRecoveryCode(tx, user.id);
  });
  loginThrottle.accounts.reset(normalizeUsername(user.username)); // eine laufende Wartezeit des Kontos soll die Anmeldung nicht blockieren
  return { ok: true, newCode, account: { id: user.id, name: user.name, username: user.username } };
}

/* ───────────── Hinweise („Notzugang wurde verwendet“) ───────────── */

export type RecoveryBannerData = {
  notices: Array<{ id: string; at: Date; userName: string; own: boolean }>;
  /** Der eigene Code ist noch nicht als gesichert bestätigt */
  unconfirmed: boolean;
};

const NOTICE_DAYS = 90;

/** Was zeigt das Banner dem Betrachter? Konto und alle Administratoren sehen jede Verwendung, bis sie sie bestätigt haben. */
export async function recoveryBannerData(viewer: { id: string; isAdmin: boolean }): Promise<RecoveryBannerData> {
  const since = new Date(authRuntime.now() - NOTICE_DAYS * 86_400_000);
  const [notices, code] = await Promise.all([
    db.recoveryNotice.findMany({
      where: { createdAt: { gte: since }, acks: { none: { userId: viewer.id } }, ...(viewer.isAdmin ? {} : { userId: viewer.id }) },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    viewer.isAdmin ? db.recoveryCode.findUnique({ where: { userId: viewer.id }, select: { confirmedAt: true } }) : null,
  ]);
  return {
    notices: notices.map((n) => ({ id: n.id, at: n.createdAt, userName: n.userName, own: n.userId === viewer.id })),
    unconfirmed: code !== null && code.confirmedAt === null,
  };
}

/** Hinweis als gesehen markieren. `client`: die Transaktion des Aufrufers (Aktions-Rahmen); Standard der normale Client. */
export async function acknowledgeRecoveryNotice(noticeId: string, viewer: { id: string; isAdmin: boolean }, client: Pick<Tx, "recoveryNotice" | "recoveryNoticeAck"> = db): Promise<void> {
  const notice = await client.recoveryNotice.findUnique({ where: { id: noticeId }, select: { userId: true } });
  if (!notice || (!viewer.isAdmin && notice.userId !== viewer.id)) return; // Hinweise gelöschter Konten (userId null) bestätigen nur Administratoren
  await client.recoveryNoticeAck.upsert({ where: { noticeId_userId: { noticeId, userId: viewer.id } }, update: {}, create: { noticeId, userId: viewer.id } });
}
