import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Prisma, PrismaClient, User } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { getAuthProvider } from "./providers";
import { accountOwner, QueueFullError, verifyPassword } from "./password";
import { authRuntime } from "./runtime";
import { loginThrottle, normalizeUsername } from "./throttle";
import { findKnownDevice, forgetCurrentDevice, readDeviceToken, recordDeviceFailure, recordDeviceSuccess, rememberDeviceSafely, type PresentedDevice } from "./devices";
import { currentClientIp } from "./network";
import { credentialVersion, pendingLogins, PENDING_TTL_MS } from "./pending";
import { authPolicy } from "./policy";
import { checkSecondFactor, recordSecondFactorFailure, secondFactorRequired, secondFactorWaitMs } from "./second-factor";
import { isLocale, LOCALE_COOKIE, THEME_COOKIE, type Locale } from "@/i18n/config";
import { THEMES, type Theme } from "@/lib/constants";
import { ipHint } from "@/lib/ip-hint";
import { safeNext } from "@/lib/safe-next";
import {
  clearingAttributes,
  cookieAttributes,
  isSecureRequest,
  pendingCookieName,
  readPendingToken,
  readSessionToken,
  SESSION_COOKIE,
  sessionCookieName,
} from "@/lib/session-cookie";
import { featureOfPermission, type Permission } from "@/modules/catalog";
import { grantedPermissions } from "@/server/auth/permissions";
import { getActiveFeatureIds } from "@/modules/features";

const SESSION_DAYS = 14;
/** Nach dieser Ruhezeit beginnt die Fehlversuchs-Zählung eines Kontos von vorn (wie im Speicher: `loginThrottle.accounts`). */
const FAILURE_DECAY_MS = 15 * 60_000;

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/** Läuft die Anfrage über HTTPS (siehe `isSecureRequest`)? Davon hängt der Cookie-Name ab: unter HTTPS nur `__Host-…`. */
async function secureCookies(): Promise<boolean> {
  return isSecureRequest((await headers()).get("x-forwarded-proto"));
}

/** Sitzungs-Token der Anfrage (nur unter dem zum Übertragungsweg passenden Namen). */
async function currentSessionToken(): Promise<string | undefined> {
  const [jar, secure] = await Promise.all([cookies(), secureCookies()]);
  return readSessionToken((name) => jar.get(name), secure);
}

/** Kennung (Hash) der Sitzung dieser Anfrage – für „Meine Sitzungen“ (die eigene Sitzung wird markiert und lässt sich dort nicht beenden). */
export async function currentSessionHash(): Promise<string | undefined> {
  const token = await currentSessionToken();
  return token ? sha256(token) : undefined;
}

export type SessionUser = {
  id: string;
  username: string;
  name: string;
  email: string | null;
  locale: Locale | null;
  theme: Theme | null;
  authSource: string;
  mustChangePassword: boolean;
  isAdmin: boolean;
  roleNames: string[];
  roleIds: string[];
  /** Zwei-Faktor-Anmeldung ist eingerichtet */
  twoFactor: boolean;
  /** Die Richtlinie verlangt den zweiten Faktor (Administratoren), er ist aber noch nicht eingerichtet: nur „Mein Konto“ ist erreichbar */
  mustSetupTwoFactor: boolean;
};

export type AppSession = {
  user: SessionUser;
  /** Aktive (nicht ausgeschaltete) Funktionen, z. B. "workshop.tires" */
  features: ReadonlySet<string>;
  /** Effektive Rechte: die Rollen des Benutzers, eingeschränkt auf aktive Funktionen */
  permissions: ReadonlySet<string>;
  can: (permission: Permission) => boolean;
  /** Nur bei Anfragen über die API: das Token, mit dem die Anfrage kam (Sitzungen über das Cookie haben es nie). */
  apiToken?: { id: string; name: string; hint: string };
};

type Account = { id: string; name: string };

export type LoginResult =
  | { ok: true; mustChangePassword: boolean; account: Account }
  /** Passwort stimmt, aber das Konto hat einen zweiten Faktor: noch **keine** Sitzung – weiter mit `verifySecondFactor` (Zwischenzustand im Cookie `so_2fa`) */
  | { ok: false; reason: "secondFactor"; account: Account }
  /** Falsches Passwort oder unbekannter Benutzer (nicht unterscheidbar); `newlyThrottled`: dieser Versuch hat die Wartezeit ausgelöst */
  | { ok: false; reason: "invalid"; account: Account | null; newlyThrottled: boolean }
  | { ok: false; reason: "inactive"; account: Account }
  /** Gedrosselt: das Konto (oder die Adresse) muss noch warten – es wurde nichts geprüft */
  | { ok: false; reason: "throttled"; retryAfterSeconds: number }
  /** Zu viele gleichzeitige Anmeldungen – bitte kurz warten */
  | { ok: false; reason: "busy" };

export type LoginContext = {
  /** Adresse des Clients (nur hinter einem Reverse-Proxy bekannt, sonst null) */
  ip?: string | null;
  /** Geräte-Token aus dem Cookie `so_device` (siehe `devices.ts`); fehlt oder ungültig = neues Gerät */
  deviceToken?: string | null;
  /** „Dieses Gerät merken“ (Opt-in): nach erfolgreicher Anmeldung entsteht ein bekanntes Gerät. Ein bereits bekanntes Gerät wird immer aufgefrischt. */
  rememberDevice?: boolean;
};

/** Gedrosselt: eine zufällige, feste Zeit per Timer warten (kein Hash, keine CPU) und die Restzeit nennen. */
async function throttledResult(waitMs: number): Promise<{ ok: false; reason: "throttled"; retryAfterSeconds: number }> {
  await authRuntime.sleep(authRuntime.between(300, 700));
  return { ok: false, reason: "throttled", retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
}

/**
 * Meldet einen Benutzer an. Reihenfolge ist Absicht:
 *  0. Ist das Gerät bekannt (gültiges Geräte-Cookie **dieses** Kontos)? Eine einzige indizierte Abfrage, nur wenn ein Cookie da ist.
 *  1. **Synchron** (ohne `await` dazwischen) prüfen, ob Konto/Adresse – bei bekanntem Gerät das Gerät – warten müssen, und den
 *     Versuch belegen: so kann ein Schwung paralleler Versuche die Drosselung nicht unterlaufen. Gedrosselte Versuche kosten nur
 *     einen Timer, keinen Hash. **Ein bekanntes Gerät unterliegt nicht der Konto-Wartezeit** (die ein Angreifer ohne das Cookie
 *     auslösen kann), sondern einer eigenen Drosselung je Gerät (Speicher **und** Datenbank); seine Fehlversuche zählen nicht gegen das Konto.
 *  2. Globales Fehlversuchs-Budget: verlangsamt, weist aber nie ab.
 *  3. Passwort prüfen. Anmeldungen: höchstens 2 gleichzeitig, begrenzte Warteschlange. Bekannte Geräte nutzen den Eigentümer-Pfad
 *     (`ownerLane`, je Konto höchstens eine laufende und eine wartende Berechnung), sie können von einer Flut fremder Anmeldungen nicht
 *     verdrängt werden und verdrängen niemanden. Unbekannte Namen **rechnen keinen Hash**; die Antwort wird per Timer auf die typische Dauer aufgefüllt.
 *  4. Dauerhafte Zähler in der Datenbank (atomar), überstehen einen Neustart.
 *  5. Hat das Konto einen zweiten Faktor, entsteht hier **noch keine Sitzung**: Ein Zwischenzustand (nur im Server) und ein kurzes Cookie genügen, weiter geht es mit
 *     `verifySecondFactor`. **Das bekannte Gerät ersetzt den zweiten Faktor nie** – es befreit nur von der Konto-Wartezeit.
 */
export async function login(username: string, password: string, context: LoginContext = {}): Promise<LoginResult> {
  const { accounts, ips, devices, budget } = loginThrottle;
  const key = normalizeUsername(username);
  const ip = context.ip ?? null;

  const presented: PresentedDevice | null = context.deviceToken ? { token: context.deviceToken, device: await findKnownDevice(context.deviceToken) } : null;
  const device = presented?.device && presented.device.username === key ? presented.device : null;

  let newlyThrottled: boolean;
  if (device) {
    const dbWait = device.lockedUntil ? Math.max(0, device.lockedUntil.getTime() - authRuntime.now()) : 0;
    const wait = Math.max(devices.check(device.id), dbWait);
    if (wait > 0) return throttledResult(wait);
    const taken = devices.take(device.id);
    newlyThrottled = taken.delayMs > 0 && devices.delayAfter(taken.attempts - 1) === 0;
  } else {
    const wait = Math.max(accounts.check(key), ip ? ips.check(ip) : 0);
    if (wait > 0) return throttledResult(wait);
    const taken = accounts.take(key);
    if (ip) ips.take(ip);
    newlyThrottled = taken.delayMs > 0 && accounts.delayAfter(taken.attempts - 1) === 0;
  }
  /** Überlast ist kein Fehlversuch des Benutzers */
  const forgive = () => {
    if (device) devices.forgive(device.id);
    else {
      accounts.forgive(key);
      if (ip) ips.forgive(ip);
    }
  };

  const extra = budget.delayMs();
  if (extra > 0) await authRuntime.sleep(extra);

  const user = await db.user.findUnique({ where: { username: key } });
  // Dauerhafte Wartezeit aus der Datenbank (z. B. nach einem Neustart): ebenfalls ohne Hash – außer für das bekannte Gerät
  if (!device && user?.lockedUntil && user.lockedUntil.getTime() > authRuntime.now()) return throttledResult(user.lockedUntil.getTime() - authRuntime.now());

  const provider = user ? getAuthProvider(user.authSource) : null;
  let valid: boolean;
  try {
    // Unbekannte Namen und Konten ohne lokales Passwort rechnen keinen Hash (`verifyPassword` füllt per Timer auf).
    valid = user && provider ? await provider.verify(user, password, { bounded: !device, owner: accountOwner(user.id) }) : await verifyPassword(password, null);
  } catch (error) {
    if (!(error instanceof QueueFullError)) throw error;
    forgive();
    return { ok: false, reason: "busy" };
  }

  const account = user ? { id: user.id, name: user.name } : null;
  if (!user || !valid) {
    budget.record();
    if (user && !device) await recordFailure(user.id);
    if (user && device) await recordDeviceFailure(device.id);
    return { ok: false, reason: "invalid", account, newlyThrottled };
  }
  if (!user.active) return { ok: false, reason: "inactive", account: account! };

  // Das Passwort stimmt: Der Versuch gleicht sich aus. Beim bekannten Gerät zählt ein Erfolg nur einen Fehlversuch weniger – er setzt die Zählung nicht auf null
  // (Cookie-Dieb mit zwei Spuren: Die Anmeldungen der Besitzerin verschaffen ihm keine neuen freien Versuche).
  if (device) {
    devices.forgive(device.id);
    await recordDeviceSuccess(device.id);
  } else {
    accounts.succeed(key);
    if (ip) ips.forgive(ip); // andere Nutzer derselben Adresse sollen sich nicht gegenseitig bremsen
  }

  // Zweiter Faktor: noch keine Sitzung. Das Gerät (bekannt oder nicht) ändert daran nichts.
  if (await secondFactorRequired(user.id)) {
    await recordPasswordOk(user.id, !device);
    const token = pendingLogins.create({ userId: user.id, username: key, credentialVersion: credentialVersion(user.passwordHash), remember: context.rememberDevice === true });
    await setPendingCookie(token);
    return { ok: false, reason: "secondFactor", account: account! };
  }

  await completeLogin(user, { resetCounters: !device, presented: presented ?? undefined, remember: context.rememberDevice === true });
  return { ok: true, mustChangePassword: user.mustChangePassword, account: account! };
}

/** Der Abschluss einer Anmeldung (Passwort allein oder mit zweitem Faktor): Zeitpunkt, Sitzung, Gerät, persönliche Einstellungen. Hier – und nur hier – entsteht die Sitzung. */
async function completeLogin(user: User, options: { resetCounters: boolean; presented: PresentedDevice | undefined; remember: boolean }): Promise<void> {
  await recordSuccess(user.id, options.resetCounters);
  await startSession(user.id);
  // Ein Fehler beim Merken des Geräts macht eine geglückte Anmeldung nicht zum Fehler (die Sitzung steht schon)
  await rememberDeviceSafely(user.id, options.presented, options.remember);

  // Persönliche Einstellungen in Cookies spiegeln (Server rendert damit ohne DB-Zugriff)
  const jar = await cookies();
  const opts = { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" as const };
  if (isLocale(user.locale)) jar.set(LOCALE_COOKIE, user.locale, opts);
  if (user.theme && (THEMES as readonly string[]).includes(user.theme)) jar.set(THEME_COOKIE, user.theme, opts);
}

/* ───────────── Zweiter Faktor bei der Anmeldung ───────────── */

export type SecondFactorResult =
  | { ok: true; mustChangePassword: boolean; account: Account; via: "totp" | "backup"; backupCodesLeft: number }
  /** Es gibt keinen (gültigen) Zwischenzustand: abgelaufen, verbraucht oder nie begonnen – zurück zur Passwort-Eingabe */
  | { ok: false; reason: "expired" }
  | { ok: false; reason: "invalid"; account: Account; newlyThrottled: boolean }
  | { ok: false; reason: "throttled"; retryAfterSeconds: number };

async function setPendingCookie(token: string): Promise<void> {
  const [jar, secure] = await Promise.all([cookies(), secureCookies()]);
  jar.set(pendingCookieName(secure), token, { ...cookieAttributes(secure), maxAge: Math.floor(PENDING_TTL_MS / 1000) });
}

async function clearPendingCookie(): Promise<void> {
  const [jar, secure] = await Promise.all([cookies(), secureCookies()]);
  jar.set(pendingCookieName(secure), "", clearingAttributes(secure));
}

/** Gibt es zu dieser Anfrage einen gültigen Zwischenzustand (Seite „Code eingeben“)? Ändert nichts. */
export async function hasPendingLogin(): Promise<boolean> {
  const [jar, secure] = await Promise.all([cookies(), secureCookies()]);
  return !!pendingLogins.get(readPendingToken((name) => jar.get(name), secure));
}

/**
 * Zweiter Schritt der Anmeldung: der Code der App oder ein Sicherungscode. Reihenfolge wie beim Passwort: **synchron** den Zwischenzustand holen, die Drosselung des Kontos
 * prüfen und den Versuch belegen; dann erst Datenbank. Ein falscher Code zählt am Zwischenzustand (5 Stück, dann muss das Passwort neu eingegeben werden), am Konto
 * (`loginThrottle.totp` und dauerhaft in `TwoFactor`) und im globalen Budget. Die Prüfung ist billig (kein Hash), also läuft sie nicht über die scrypt-Pfade.
 * Es gibt kein Benutzerorakel: Diesen Schritt erreicht nur, wer das richtige Passwort kannte.
 */
export async function verifySecondFactor(code: string, context: { ip?: string | null } = {}): Promise<SecondFactorResult> {
  void context;
  const [jar, secure] = await Promise.all([cookies(), secureCookies()]);
  const token = readPendingToken((name) => jar.get(name), secure);
  const pending = pendingLogins.get(token);
  if (!pending || !token) return { ok: false, reason: "expired" };

  const { totp: gate, budget } = loginThrottle;
  const wait = gate.check(pending.userId);
  if (wait > 0) return throttledResult(wait);
  const taken = gate.take(pending.userId);
  const newlyThrottled = taken.delayMs > 0 && gate.delayAfter(taken.attempts - 1) === 0;

  const extra = budget.delayMs();
  if (extra > 0) await authRuntime.sleep(extra);

  const user = await db.user.findUnique({ where: { id: pending.userId } });
  if (!user || !user.active) {
    pendingLogins.delete(token);
    await clearPendingCookie();
    return { ok: false, reason: "expired" };
  }
  // Das Passwort hat sich seit dem ersten Schritt geändert (Wechsel, Zurücksetzen, Notzugang): der Zwischenzustand gilt nicht mehr, das Passwort ist neu einzugeben
  if (credentialVersion(user.passwordHash) !== pending.credentialVersion) {
    pendingLogins.delete(token);
    await clearPendingCookie();
    return { ok: false, reason: "expired" };
  }
  const dbWait = await secondFactorWaitMs(user.id);
  if (dbWait > 0) return throttledResult(dbWait);

  const checked = await checkSecondFactor(user.id, code.slice(0, 64));
  if (!checked.ok) {
    budget.record();
    await recordSecondFactorFailure(user.id);
    if (!pendingLogins.fail(token)) await clearPendingCookie();
    return { ok: false, reason: "invalid", account: { id: user.id, name: user.name }, newlyThrottled };
  }

  gate.forgive(user.id); // ein Erfolg gleicht nur den eigenen Versuch aus
  pendingLogins.delete(token);
  await clearPendingCookie();
  const deviceToken = await readDeviceToken();
  const presented: PresentedDevice | undefined = deviceToken ? { token: deviceToken, device: await findKnownDevice(deviceToken) } : undefined;
  await completeLogin(user, { resetCounters: false, presented, remember: pending.remember });
  return { ok: true, mustChangePassword: user.mustChangePassword, account: { id: user.id, name: user.name }, via: checked.via, backupCodesLeft: checked.backupCodesLeft };
}

/**
 * Anmeldezähler eines Kontos schreiben, **ohne `updatedAt` zu verändern**: Das Benutzerformular nutzt `updatedAt` als Version
 * (gleichzeitiges Bearbeiten); ein Fehlversuch oder eine Anmeldung darf kein „Das wurde zwischenzeitlich geändert“ auslösen. Lesen
 * und Schreiben laufen in einer Transaktion (atomar). `compute` bekommt den aktuellen Stand und liefert die zu schreibenden Felder.
 */
async function updateLoginState(
  userId: string,
  compute: (current: { failedLogins: number; lockedUntil: Date | null }) => { failedLogins?: number; lockedUntil?: Date | null; lastLoginAt?: Date },
): Promise<void> {
  await db.$transaction(async (tx) => {
    const current = await tx.user.findUnique({ where: { id: userId }, select: { updatedAt: true, failedLogins: true, lockedUntil: true } });
    if (!current) return;
    await tx.user.update({ where: { id: userId }, data: { ...compute(current), updatedAt: current.updatedAt } });
  });
}

/** Fehlversuch dauerhaft festhalten: Zähler erhöhen, Wartezeit daraus ableiten (nur verlängern, nie verkürzen). */
async function recordFailure(userId: string): Promise<void> {
  const now = authRuntime.now();
  await updateLoginState(userId, (current) => {
    const stale = current.lockedUntil !== null && now - current.lockedUntil.getTime() > FAILURE_DECAY_MS;
    const failedLogins = stale ? 1 : current.failedLogins + 1;
    const until = now + loginThrottle.accounts.delayAfter(failedLogins);
    if (!current.lockedUntil || current.lockedUntil.getTime() < until) return { failedLogins, lockedUntil: new Date(until) };
    return { failedLogins };
  });
}

/** Erfolgreiche Anmeldung: Zeitpunkt festhalten; nur eine Anmeldung ohne bekanntes Gerät setzt die Zähler des Kontos zurück. */
async function recordSuccess(userId: string, resetCounters: boolean): Promise<void> {
  await updateLoginState(userId, () => ({ lastLoginAt: new Date(authRuntime.now()), ...(resetCounters ? { failedLogins: 0, lockedUntil: null } : {}) }));
}

/** Das Passwort stimmte, der zweite Faktor steht noch aus: nur die Zähler des Kontos zurücksetzen (die Anmeldung gilt erst mit dem Code als erfolgt). */
async function recordPasswordOk(userId: string, resetCounters: boolean): Promise<void> {
  if (resetCounters) await updateLoginState(userId, () => ({ failedLogins: 0, lockedUntil: null }));
}

/** Wartezeit eines Kontos aufheben (Administration): Zähler in Datenbank und Speicher zurücksetzen. */
export async function resetAccountThrottle(userId: string): Promise<void> {
  let username: string | null = null;
  await db.$transaction(async (tx) => {
    const current = await tx.user.findUnique({ where: { id: userId }, select: { username: true, updatedAt: true } });
    if (!current) return;
    username = current.username;
    await tx.user.update({ where: { id: userId }, data: { failedLogins: 0, lockedUntil: null, updatedAt: current.updatedAt } }); // `updatedAt` bleibt (Formular-Version)
  });
  if (username) loginThrottle.accounts.reset(normalizeUsername(username));
}

async function startSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(authRuntime.now() + SESSION_DAYS * 86_400_000);
  const [h, ip] = await Promise.all([headers(), currentClientIp()]);
  await db.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      expiresAt,
      userAgent: h.get("user-agent")?.slice(0, 200) ?? null,
      ipHint: ipHint(ip),
    },
  });
  // abgelaufene Sessions nebenbei aufräumen
  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  const jar = await cookies();
  const secure = await secureCookies();
  jar.set(sessionCookieName(secure), token, { ...cookieAttributes(secure), expires: expiresAt });
}

/** Das Sitzungs-Cookie löschen (mit Secure und Pfad „/“: sonst ignoriert der Browser das Löschen eines `__Host-`-Cookies). */
export async function clearSessionCookie(): Promise<void> {
  const [jar, secure] = await Promise.all([cookies(), secureCookies()]);
  jar.set(sessionCookieName(secure), "", clearingAttributes(secure));
  // Ein Klartext-Cookie aus HTTP-Zeiten räumen wir unter HTTPS gleich mit weg
  if (secure && jar.has(SESSION_COOKIE)) jar.set(SESSION_COOKIE, "", clearingAttributes(false));
}

/** Abmelden. `forgetDevice`: zusätzlich das bekannte Gerät dieses Browsers vergessen (Datenbank und Cookie) – für geteilte Rechner. */
export async function logout(options: { forgetDevice?: boolean } = {}) {
  const token = await currentSessionToken();
  if (token) {
    const row = await db.session.findUnique({ where: { tokenHash: sha256(token) }, select: { userId: true } });
    await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
    if (options.forgetDevice && row) await forgetCurrentDevice(row.userId);
  }
  await clearSessionCookie();
}

/**
 * Alle Sessions eines Benutzers beenden (z. B. nach Passwortänderung/Deaktivierung). Innerhalb einer Operation immer mit `client = tx` (gleiche Transaktion
 * wie die Passwortänderung – sonst bliebe nach einem Fehler dazwischen die alte Sitzung gültig); `revokeAccess` (`revoke.ts`) fasst Sitzungen, Geräte und Tokens zusammen.
 */
export async function revokeSessions(userId: string, exceptCurrent = false, client: Pick<PrismaClient | Prisma.TransactionClient, "session"> = db) {
  let keep: string | undefined;
  if (exceptCurrent) {
    const token = await currentSessionToken();
    keep = token ? sha256(token) : undefined;
  }
  await client.session.deleteMany({ where: { userId, ...(keep ? { NOT: { tokenHash: keep } } : {}) } });
}

export type SessionRow = { id: string; userAgent: string | null; ipHint: string | null; createdAt: Date; lastUsedAt: Date; current: boolean };

/** Die gültigen Sitzungen eines Kontos, die dieser Anfrage markiert; zuletzt benutzte zuerst. */
export async function listSessions(userId: string): Promise<SessionRow[]> {
  const [rows, mine] = await Promise.all([
    db.session.findMany({ where: { userId, expiresAt: { gt: new Date() } }, orderBy: { lastUsedAt: "desc" }, select: { id: true, tokenHash: true, userAgent: true, ipHint: true, createdAt: true, lastUsedAt: true } }),
    currentSessionHash(),
  ]);
  return rows.map((row) => ({ id: row.id, userAgent: row.userAgent, ipHint: row.ipHint, createdAt: row.createdAt, lastUsedAt: row.lastUsedAt, current: row.tokenHash === mine }));
}

/** Aktuelle Sitzung inkl. effektiver Berechtigungen (pro Request gecacht). */
export const getSession = cache(async (): Promise<AppSession | null> => {
  const token = await currentSessionToken();
  if (!token) return null;

  const row = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: {
      user: {
        include: { roles: { include: { role: { include: { permissions: true } } } }, twoFactor: { select: { enabledAt: true } } },
      },
    },
  });
  if (!row || row.expiresAt < new Date() || !row.user.active) return null;

  // Leerlauf-Abmeldung (Einstellung, Standard aus): zu lange ohne Anfrage -> die Sitzung endet. Mit eingeschalteter Frist wird die letzte Nutzung minütlich
  // festgehalten (sonst höchstens alle 10 Minuten), die Frist gilt also auf etwa eine Minute genau.
  const policy = await authPolicy();
  const now = authRuntime.now();
  if (policy.idleTimeoutHours > 0 && now - row.lastUsedAt.getTime() > policy.idleTimeoutHours * 3_600_000) {
    await db.session.deleteMany({ where: { id: row.id } }).catch(() => {});
    return null;
  }
  if (now - row.lastUsedAt.getTime() > (policy.idleTimeoutHours > 0 ? 60_000 : 10 * 60_000)) {
    await db.session.update({ where: { id: row.id }, data: { lastUsedAt: new Date(now) } }).catch(() => {});
  }

  const roles = row.user.roles.map((r) => r.role);
  const isAdmin = roles.some((r) => r.isAdmin);
  // Ausgeschaltete Funktionen: ihre Rechte fallen für alle weg (auch für Administratoren).
  // Da jede Seite, Action und API-Route über Rechte schützt, sperrt das die Funktion überall.
  const features = await getActiveFeatureIds();
  const permissions = grantedPermissions(roles, features);
  const u = row.user;
  const twoFactor = !!u.twoFactor?.enabledAt;
  return {
    user: {
      id: u.id,
      username: u.username,
      name: u.name,
      email: u.email,
      locale: isLocale(u.locale) ? u.locale : null,
      theme: (THEMES as readonly string[]).includes(u.theme ?? "") ? (u.theme as Theme) : null,
      authSource: u.authSource,
      mustChangePassword: u.mustChangePassword,
      isAdmin,
      roleNames: roles.map((r) => r.name),
      roleIds: roles.map((r) => r.id),
      twoFactor,
      mustSetupTwoFactor: policy.requireTwoFactorForAdmins && isAdmin && !twoFactor,
    },
    features,
    permissions,
    can: (p) => permissions.has(p),
  };
});

/**
 * Zur Anmeldung leiten – **mit Rücksprungziel**: Der Proxy reicht den Pfad der Anfrage als `x-so-path` weiter; nach der Anmeldung geht es auf dieselbe Seite zurück
 * (`safeNext`, nur interne Pfade). `expired=1` lässt die Anmeldeseite sagen, dass die Sitzung zu Ende ist (Leerlauf, abgemeldet an anderer Stelle, Cookie ohne Sitzung).
 */
async function redirectToLogin(): Promise<never> {
  const path = (await headers()).get("x-so-path");
  if (!path) redirect("/login"); // ohne Proxy (Tests, Hintergrundaufrufe) kennen wir die Seite nicht
  const next = safeNext(path);
  const target = next === "/" || next.startsWith("/login") ? "" : `&next=${encodeURIComponent(next)}`;
  redirect(`/login?expired=1${target}`);
}

/**
 * Für Server Components/Actions: Login erzwingen. Benutzer mit `mustChangePassword` (oder verlangtem, noch fehlendem zweiten Faktor) werden zur
 * Kontoseite umgeleitet (außer dort: `allowPasswordChange`).
 */
export async function requireSession(opts: { allowPasswordChange?: boolean } = {}): Promise<AppSession> {
  const session = await getSession();
  if (!session) return redirectToLogin();
  if ((session.user.mustChangePassword || session.user.mustSetupTwoFactor) && !opts.allowPasswordChange) redirect("/account");
  return session;
}

/**
 * Für `generateMetadata`: liefert die Sitzung nur, wenn die Person angemeldet ist, kein Passwortwechsel aussteht und sie das Recht hat – sonst
 * `null`, **ohne** Weiterleitung oder 404 (Metadaten sind kein Ort dafür). Der Titel einer Detailseite (Kundenname, Rechnungsnummer …) darf nur
 * mit dem Recht der Seite aus der Datenbank gelesen werden: Er steht sonst schon im ersten gestreamten HTML, noch bevor die Seite selbst prüft.
 */
export async function sessionIfAllowed(permission: Permission): Promise<AppSession | null> {
  const session = await getSession();
  if (!session || session.user.mustChangePassword || session.user.mustSetupTwoFactor) return null;
  if (!session.features.has(featureOfPermission(permission) ?? "") || !session.can(permission)) return null;
  return session;
}

/**
 * Login + Berechtigung erzwingen. Gehört das Recht zu einer ausgeschalteten Funktion, gibt es die Seite
 * schlicht nicht (404); sonst ohne Recht -> /forbidden.
 */
export async function requirePermission(permission: Permission): Promise<AppSession> {
  const session = await requireSession();
  if (!session.features.has(featureOfPermission(permission) ?? "")) notFound();
  if (!session.can(permission)) redirect("/forbidden");
  return session;
}
