import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { db } from "@/server/db";
import { cookieAttributes, deviceCookieName, isSecureRequest, readDeviceToken as pickDeviceToken } from "@/lib/session-cookie";
import { authRuntime } from "./runtime";

/**
 * „Bekanntes Gerät“ – damit ein Dauerbeschuss das Konto nicht für den Besitzer sperrt.
 *
 * Problem: Die Wartezeit je Konto (nach den freien Fehlversuchen 2 s, 4 s … bis 90 s) bremst auch den Besitzer, wenn jemand
 * ohne Pause auf den Namen schießt: Der Angreifer holt sich jedes frei werdende Zeitfenster zuerst. Lösung: Nach einer erfolgreichen
 * Anmeldung setzt die App im Browser ein langes, zufälliges **Geräte-Cookie** (HttpOnly, SameSite=Lax, unter HTTPS `__Host-`);
 * in der Datenbank steht nur sein SHA-256-Hash, gebunden an das Konto. Anmeldungen **mit gültigem Geräte-Cookie dieses Kontos**
 * unterliegen nicht der Konto-Wartezeit (die der Angreifer ohne das Cookie auslöst), sondern einer eigenen Drosselung je Gerät
 * und dem globalen Budget. Wer das Cookie nicht hat (neues Gerät, Angreifer), bleibt in der Konto-Wartezeit – Raten wird dadurch
 * nicht leichter, nur das Aussperren des Besitzers schwerer. Ausweg für ein neues Gerät während eines Angriffs: warten (höchstens
 * 90 s je Versuch) oder der Wiederherstellungs-Code.
 */
export const DEVICE_MAX_PER_USER = 10;
export const DEVICE_TTL_DAYS = 180;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export type KnownDevice = { id: string; userId: string; username: string };

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
  return { id: row.id, userId: row.userId, username: row.user.username };
}

/**
 * Nach einer erfolgreichen Anmeldung: Gerät merken. Ein vorhandenes Gerät desselben Kontos wird aufgefrischt (das Cookie läuft
 * wieder 180 Tage), sonst entsteht ein neues; je Konto bleiben höchstens 10 (die zuletzt benutzten), abgelaufene verschwinden.
 */
export async function rememberDevice(userId: string, presented?: { token: string; device: KnownDevice | null }): Promise<void> {
  const now = authRuntime.now();
  let token: string;
  if (presented?.device && presented.device.userId === userId) {
    token = presented.token;
    await db.knownDevice.update({ where: { id: presented.device.id }, data: { lastUsedAt: new Date(now) } });
  } else {
    token = randomBytes(32).toString("base64url");
    const userAgent = (await headers()).get("user-agent")?.slice(0, 200) ?? null;
    await db.knownDevice.create({ data: { tokenHash: sha256(token), userId, userAgent, createdAt: new Date(now), lastUsedAt: new Date(now) } });
    const rows = await db.knownDevice.findMany({ where: { userId }, orderBy: { lastUsedAt: "desc" }, select: { id: true, lastUsedAt: true } });
    const cutoff = now - DEVICE_TTL_DAYS * 86_400_000;
    const drop = rows.filter((row, index) => index >= DEVICE_MAX_PER_USER || row.lastUsedAt.getTime() < cutoff).map((row) => row.id);
    if (drop.length > 0) await db.knownDevice.deleteMany({ where: { id: { in: drop } } });
  }
  const [jar, isSecure] = await Promise.all([cookies(), secure()]);
  jar.set(deviceCookieName(isSecure), token, { ...cookieAttributes(isSecure), maxAge: DEVICE_TTL_DAYS * 86_400 });
}

/** Alle bekannten Geräte eines Kontos vergessen (nach Passwortänderung/Deaktivierung durch die Administration); `exceptCurrent`: das eigene behalten. */
export async function revokeDevices(userId: string, exceptCurrent = false): Promise<void> {
  const token = exceptCurrent ? await readDeviceToken() : undefined;
  const keep = token ? sha256(token) : undefined;
  await db.knownDevice.deleteMany({ where: { userId, ...(keep ? { NOT: { tokenHash: keep } } : {}) } });
}
