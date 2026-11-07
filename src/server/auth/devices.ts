import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { logError } from "@/lib/log-safe";
import { db } from "@/server/db";
import { clearingAttributes, cookieAttributes, deviceCookieName, isSecureRequest, readDeviceToken as pickDeviceToken } from "@/lib/session-cookie";
import { currentClientIp } from "./network";
import { authRuntime } from "./runtime";
import { loginThrottle } from "./throttle";
import { ipHint } from "@/lib/ip-hint";

/**
 * „Bekanntes Gerät“ – damit ein Dauerbeschuss das Konto nicht für den Besitzer sperrt.
 *
 * Problem: Die Wartezeit je Konto (nach den freien Fehlversuchen 2 s, 4 s … bis 90 s) bremst auch den Besitzer, wenn jemand
 * ohne Pause auf den Namen schießt: Der Angreifer holt sich jedes frei werdende Zeitfenster zuerst. Lösung: Wer bei der Anmeldung **„Dieses Gerät merken“**
 * wählt (Opt-in, nie automatisch), bekommt im Browser ein langes, zufälliges **Geräte-Cookie** (HttpOnly, SameSite=Lax, unter HTTPS `__Host-`);
 * in der Datenbank steht nur sein SHA-256-Hash, gebunden an das Konto. Anmeldungen **mit gültigem Geräte-Cookie dieses Kontos**
 * unterliegen nicht der Konto-Wartezeit (die der Angreifer ohne das Cookie auslöst), sondern einer eigenen Drosselung je Gerät
 * und dem globalen Budget. Wer das Cookie nicht hat (neues Gerät, Angreifer), bleibt in der Konto-Wartezeit – Raten wird dadurch
 * nicht leichter, nur das Aussperren des Besitzers schwerer. Ausweg für ein neues Gerät während eines Angriffs: warten (höchstens
 * 90 s je Versuch) oder der Wiederherstellungs-Code.
 *
 * **Was das Gerät nie ersetzt:** das Passwort und – bei eingerichteter Zwei-Faktor-Anmeldung – den zweiten Faktor (R2-SEC-05). Es befreit ausschließlich von der Konto-Wartezeit.
 *
 * **Verwaltung:** Jede Person sieht ihre Geräte im Konto und kann sie widerrufen; beim Abmelden lässt sich das Gerät auf Wunsch vergessen. Ein neues Gerät verdrängt
 * nur Geräte, die nie wieder benutzt wurden (`useCount` 1) – nie ein echtes, benutztes (R2-SEC-02); sind alle 10 Plätze mit benutzten Geräten belegt, wird das
 * neue nicht gemerkt. Fehlversuche vom Gerät aus zählen **auch in der Datenbank** (überstehen einen Neustart, R2-SEC-03): Die Wartezeit je Gerät steht dann in
 * `KnownDevice.lockedUntil`, nicht nur im Speicher.
 */
export const DEVICE_MAX_PER_USER = 10;
export const DEVICE_TTL_DAYS = 180;
/** Nach dieser Ruhezeit beginnt die Fehlversuchs-Zählung eines Geräts von vorn (wie im Speicher: `loginThrottle.devices`). */
const FAILURE_DECAY_MS = 15 * 60_000;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export type KnownDevice = { id: string; userId: string; username: string; lockedUntil: Date | null };
export type PresentedDevice = { token: string; device: KnownDevice | null };

async function secure(): Promise<boolean> {
  return isSecureRequest((await headers()).get("x-forwarded-proto"));
}

/** Das Geräte-Token der Anfrage (nur unter dem zum Übertragungsweg passenden Cookie-Namen). */
export async function readDeviceToken(): Promise<string | undefined> {
  const [jar, isSecure] = await Promise.all([cookies(), secure()]);
  return pickDeviceToken((name) => jar.get(name), isSecure);
}

/** Das Gerät zu einem Token: nur wenn es existiert und in den letzten 180 Tagen benutzt wurde. Eine einzige indizierte Abfrage. */
export async function findKnownDevice(token: string | null | undefined): Promise<KnownDevice | null> {
  if (!token || token.length < 32 || token.length > 200) return null;
  const row = await db.knownDevice.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { select: { username: true } } } });
  if (!row || row.lastUsedAt.getTime() < authRuntime.now() - DEVICE_TTL_DAYS * 86_400_000) return null;
  return { id: row.id, userId: row.userId, username: row.user.username, lockedUntil: row.lockedUntil };
}

/** Geräte-Cookie setzen (180 Tage). */
async function setDeviceCookie(token: string): Promise<void> {
  const [jar, isSecure] = await Promise.all([cookies(), secure()]);
  jar.set(deviceCookieName(isSecure), token, { ...cookieAttributes(isSecure), maxAge: DEVICE_TTL_DAYS * 86_400 });
}

/** Geräte-Cookie löschen (mit Secure und Pfad „/“, sonst ignoriert der Browser das Löschen eines `__Host-`-Cookies). */
export async function clearDeviceCookie(): Promise<void> {
  const [jar, isSecure] = await Promise.all([cookies(), secure()]);
  jar.set(deviceCookieName(isSecure), "", clearingAttributes(isSecure));
}

/**
 * Nach einer erfolgreichen Anmeldung: Gerät merken – **nur auf Wunsch** (`remember`) oder um ein bereits bekanntes Gerät des Kontos aufzufrischen (das Cookie läuft
 * wieder 180 Tage). Alles in einer Transaktion (R2-SEC-04): Ein gleichzeitiges Widerrufen (`revokeDevices`) lässt hier nie einen Fehler entstehen – das Gerät ist dann
 * eben weg und wird (bei Wunsch) neu angelegt. Gibt zurück, ob nach der Anmeldung ein Gerät gemerkt ist.
 *
 * Platz schaffen: abgelaufene Geräte verschwinden; sind danach noch 10 da, fällt das älteste **nie wieder benutzte** weg (`useCount` 1) – gibt es keines, wird das
 * neue Gerät nicht gemerkt (ein benutztes Gerät verdrängt nie ein anderes, auch nicht durch viele private Sitzungen).
 */
export async function rememberDevice(userId: string, presented: PresentedDevice | undefined, remember: boolean): Promise<boolean> {
  const now = authRuntime.now();
  const [h, ip] = await Promise.all([headers(), currentClientIp()]);
  const userAgent = h.get("user-agent")?.slice(0, 200) ?? null;
  const hint = ipHint(ip);

  const token = await db.$transaction(async (tx) => {
    if (presented?.device && presented.device.userId === userId) {
      const refreshed = await tx.knownDevice.updateMany({
        where: { id: presented.device.id, userId },
        data: { lastUsedAt: new Date(now), useCount: { increment: 1 }, userAgent, ...(hint ? { ipHint: hint } : {}) },
      });
      if (refreshed.count === 1) return presented.token;
      // das Gerät wurde gerade widerrufen: weiter wie ohne Cookie
    }
    if (!remember) return null;

    const cutoff = new Date(now - DEVICE_TTL_DAYS * 86_400_000);
    await tx.knownDevice.deleteMany({ where: { userId, lastUsedAt: { lt: cutoff } } });
    const rows = await tx.knownDevice.findMany({ where: { userId }, orderBy: { lastUsedAt: "asc" }, select: { id: true, useCount: true } });
    if (rows.length >= DEVICE_MAX_PER_USER) {
      const victim = rows.find((row) => row.useCount <= 1);
      if (!victim) return null; // alle Plätze gehören benutzten Geräten: nichts verdrängen
      await tx.knownDevice.deleteMany({ where: { id: victim.id } });
    }
    const fresh = randomBytes(32).toString("base64url");
    await tx.knownDevice.create({ data: { tokenHash: sha256(fresh), userId, userAgent, ipHint: hint, createdAt: new Date(now), lastUsedAt: new Date(now) } });
    return fresh;
  });

  if (token) await setDeviceCookie(token);
  else if (presented) await clearDeviceCookie(); // ungültiges oder widerrufenes Cookie nicht liegen lassen
  return token !== null;
}

/** `rememberDevice` ohne Risiko für die Anmeldung: Ein Fehler hier darf eine geglückte Anmeldung nie zu einem Fehler machen (die Sitzung steht schon). */
export async function rememberDeviceSafely(userId: string, presented: PresentedDevice | undefined, remember: boolean): Promise<void> {
  try {
    await rememberDevice(userId, presented, remember);
  } catch (error) {
    logError("devices:remember", error);
  }
}

/** Alle bekannten Geräte eines Kontos vergessen (nach Passwortänderung/Deaktivierung durch die Administration); `exceptCurrent`: das eigene behalten. */
export async function revokeDevices(userId: string, exceptCurrent = false, client: Pick<PrismaClient | Prisma.TransactionClient, "knownDevice"> = db): Promise<void> {
  const token = exceptCurrent ? await readDeviceToken() : undefined;
  const keep = token ? sha256(token) : undefined;
  await client.knownDevice.deleteMany({ where: { userId, ...(keep ? { NOT: { tokenHash: keep } } : {}) } });
}

/** Das Gerät dieses Browsers vergessen (Datenbank und Cookie) – beim Abmelden auf Wunsch und in der Geräteliste. */
export async function forgetCurrentDevice(userId: string): Promise<void> {
  const token = await readDeviceToken();
  if (token) await db.knownDevice.deleteMany({ where: { tokenHash: sha256(token), userId } });
  await clearDeviceCookie();
}

export type DeviceRow = { id: string; userAgent: string | null; ipHint: string | null; createdAt: Date; lastUsedAt: Date; current: boolean };

/** Die bekannten Geräte eines Kontos, das Gerät dieses Browsers markiert; zuletzt benutzte zuerst. */
export async function listDevices(userId: string): Promise<DeviceRow[]> {
  const [rows, token] = await Promise.all([
    db.knownDevice.findMany({ where: { userId }, orderBy: { lastUsedAt: "desc" }, select: { id: true, tokenHash: true, userAgent: true, ipHint: true, createdAt: true, lastUsedAt: true } }),
    readDeviceToken(),
  ]);
  const mine = token ? sha256(token) : null;
  return rows.map((row) => ({ id: row.id, userAgent: row.userAgent, ipHint: row.ipHint, createdAt: row.createdAt, lastUsedAt: row.lastUsedAt, current: row.tokenHash === mine }));
}

/* ───────────── Fehlversuche vom Gerät: dauerhaft (R2-SEC-03) ───────────── */

/**
 * Einen Fehlversuch vom Gerät aus festhalten: Zähler erhöhen und die Wartezeit daraus ableiten (nur verlängern, nie verkürzen). `lockedUntil` ist immer der Zeitpunkt
 * des letzten Fehlversuchs plus Wartezeit – daran erkennt die Zählung auch ohne Wartezeit, ob sie veraltet ist (Ruhezeit 15 Minuten).
 */
export async function recordDeviceFailure(deviceId: string): Promise<void> {
  const now = authRuntime.now();
  await db.$transaction(async (tx) => {
    const current = await tx.knownDevice.findUnique({ where: { id: deviceId }, select: { failedLogins: true, lockedUntil: true } });
    if (!current) return;
    const stale = current.lockedUntil !== null && now - current.lockedUntil.getTime() > FAILURE_DECAY_MS;
    const failedLogins = stale ? 1 : current.failedLogins + 1;
    const until = now + loginThrottle.devices.delayAfter(failedLogins);
    await tx.knownDevice.updateMany({ where: { id: deviceId }, data: { failedLogins, lockedUntil: new Date(Math.max(until, current.lockedUntil?.getTime() ?? 0)) } });
  });
}

/**
 * Erfolgreiche Anmeldung vom Gerät: ein Fehlversuch weniger – **nicht** alle (Cookie-Dieb mit zwei Spuren): Wer das Cookie gestohlen hat und raten will, bekommt
 * nicht jedes Mal 5 neue freie Versuche, wenn die Besitzerin sich anmeldet. Der Erfolg selbst gleicht nur den Versuch aus, den er verbraucht hat.
 */
export async function recordDeviceSuccess(deviceId: string): Promise<void> {
  await db.knownDevice.updateMany({ where: { id: deviceId, failedLogins: { gt: 0 } }, data: { failedLogins: { decrement: 1 } } });
}
