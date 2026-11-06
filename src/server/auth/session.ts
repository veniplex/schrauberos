import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { db } from "@/server/db";
import { getAuthProvider } from "./providers";
import { QueueFullError, verifyPassword } from "./password";
import { authRuntime } from "./runtime";
import { loginThrottle, normalizeUsername } from "./throttle";
import { isLocale, LOCALE_COOKIE, THEME_COOKIE, type Locale } from "@/i18n/config";
import { THEMES, type Theme } from "@/lib/constants";
import { readSessionToken, SESSION_COOKIE_NAMES, sessionCookieName } from "@/lib/session-cookie";
import { ALL_PERMISSIONS, featureOfPermission, type Permission } from "@/modules/catalog";
import { getActiveFeatureIds } from "@/modules/features";

const SESSION_DAYS = 14;
/** Nach dieser Ruhezeit beginnt die Fehlversuchs-Zählung eines Kontos von vorn (wie im Speicher: `loginThrottle.accounts`). */
const FAILURE_DECAY_MS = 15 * 60_000;

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/**
 * Secure-Cookies nur über HTTPS – automatisch erkannt am Header des Reverse Proxys (`x-forwarded-proto`). Ohne Proxy (reines
 * HTTP im LAN) bleibt das Flag aus, sonst wäre kein Login möglich. SESSION_COOKIE_SECURE=true|false erzwingt einen Wert.
 */
async function secureCookies(): Promise<boolean> {
  const flag = process.env.SESSION_COOKIE_SECURE;
  if (flag) return flag === "true";
  const proto = (await headers()).get("x-forwarded-proto")?.split(",")[0]?.trim();
  return proto === "https";
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
};

export type AppSession = {
  user: SessionUser;
  /** Aktive (nicht ausgeschaltete) Funktionen, z. B. "workshop.tires" */
  features: ReadonlySet<string>;
  /** Effektive Rechte: die Rollen des Benutzers, eingeschränkt auf aktive Funktionen */
  permissions: ReadonlySet<string>;
  can: (permission: Permission) => boolean;
};

type Account = { id: string; name: string };

export type LoginResult =
  | { ok: true; mustChangePassword: boolean; account: Account }
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
};

/** Gedrosselt: eine zufällige, feste Zeit per Timer warten (kein Hash, keine CPU) und die Restzeit nennen. */
async function throttledResult(waitMs: number): Promise<LoginResult> {
  await authRuntime.sleep(authRuntime.between(300, 700));
  return { ok: false, reason: "throttled", retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
}

/**
 * Meldet einen Benutzer an. Reihenfolge ist Absicht:
 *  1. **Synchron** (vor dem ersten `await`) prüfen, ob Konto/Adresse warten müssen, und den Versuch belegen – so kann ein Schwung
 *     paralleler Versuche die Drosselung nicht unterlaufen. Gedrosselte Versuche kosten nur einen Timer, keinen Hash.
 *  2. Globales Fehlversuchs-Budget: verlangsamt, weist aber nie ab.
 *  3. Passwort prüfen (höchstens 2 gleichzeitig, begrenzte Warteschlange). Unbekannte Namen werden wie bekannte behandelt.
 *  4. Dauerhafte Zähler in der Datenbank (atomar), überstehen einen Neustart.
 */
export async function login(username: string, password: string, context: LoginContext = {}): Promise<LoginResult> {
  const { accounts, ips, budget } = loginThrottle;
  const key = normalizeUsername(username);
  const ip = context.ip ?? null;

  const wait = Math.max(accounts.check(key), ip ? ips.check(ip) : 0);
  if (wait > 0) return throttledResult(wait);
  const taken = accounts.take(key);
  if (ip) ips.take(ip);
  const newlyThrottled = taken.delayMs > 0 && accounts.delayAfter(taken.attempts - 1) === 0;

  const extra = budget.delayMs();
  if (extra > 0) await authRuntime.sleep(extra);

  const user = await db.user.findUnique({ where: { username: key } });
  // Dauerhafte Wartezeit aus der Datenbank (z. B. nach einem Neustart): ebenfalls ohne Hash
  if (user?.lockedUntil && user.lockedUntil.getTime() > authRuntime.now()) return throttledResult(user.lockedUntil.getTime() - authRuntime.now());

  const provider = user ? getAuthProvider(user.authSource) : null;
  let valid: boolean;
  try {
    // Immer einen Hash prüfen (auch bei unbekanntem Benutzer) -> kein Timing-Orakel.
    valid = user && provider ? await provider.verify(user, password, { bounded: true }) : await verifyPassword(password, null, { bounded: true });
  } catch (error) {
    if (!(error instanceof QueueFullError)) throw error;
    // Überlast ist kein Fehlversuch des Benutzers
    accounts.forgive(key);
    if (ip) ips.forgive(ip);
    return { ok: false, reason: "busy" };
  }

  const account = user ? { id: user.id, name: user.name } : null;
  if (!user || !valid) {
    budget.record();
    if (user) await recordFailure(user);
    return { ok: false, reason: "invalid", account, newlyThrottled };
  }
  if (!user.active) return { ok: false, reason: "inactive", account: account! };

  accounts.succeed(key);
  if (ip) ips.forgive(ip); // andere Nutzer derselben Adresse sollen sich nicht gegenseitig bremsen
  await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date(authRuntime.now()) } });
  await startSession(user.id);

  // Persönliche Einstellungen in Cookies spiegeln (Server rendert damit ohne DB-Zugriff)
  const jar = await cookies();
  const opts = { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" as const };
  if (isLocale(user.locale)) jar.set(LOCALE_COOKIE, user.locale, opts);
  if (user.theme && (THEMES as readonly string[]).includes(user.theme)) jar.set(THEME_COOKIE, user.theme, opts);

  return { ok: true, mustChangePassword: user.mustChangePassword, account: account! };
}

/** Fehlversuch dauerhaft festhalten: Zähler atomar erhöhen, Wartezeit daraus ableiten (und nur verlängern, nie verkürzen). */
async function recordFailure(user: { id: string; lockedUntil: Date | null }): Promise<void> {
  const now = authRuntime.now();
  const stale = user.lockedUntil !== null && now - user.lockedUntil.getTime() > FAILURE_DECAY_MS;
  const { failedLogins } = await db.user.update({
    where: { id: user.id },
    data: { failedLogins: stale ? 1 : { increment: 1 } },
    select: { failedLogins: true },
  });
  const until = new Date(now + loginThrottle.accounts.delayAfter(failedLogins));
  await db.user.updateMany({ where: { id: user.id, OR: [{ lockedUntil: null }, { lockedUntil: { lt: until } }] }, data: { lockedUntil: until } });
}

/** Wartezeit eines Kontos aufheben (Administration): Zähler in Datenbank und Speicher zurücksetzen. */
export async function resetAccountThrottle(userId: string): Promise<void> {
  const user = await db.user.update({ where: { id: userId }, data: { failedLogins: 0, lockedUntil: null }, select: { username: true } });
  loginThrottle.accounts.reset(normalizeUsername(user.username));
}

async function startSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(authRuntime.now() + SESSION_DAYS * 86_400_000);
  const h = await headers();
  await db.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      expiresAt,
      userAgent: h.get("user-agent")?.slice(0, 200) ?? null,
    },
  });
  // abgelaufene Sessions nebenbei aufräumen
  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  const jar = await cookies();
  const secure = await secureCookies();
  jar.set(sessionCookieName(secure), token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function logout() {
  const jar = await cookies();
  const token = readSessionToken((name) => jar.get(name));
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  for (const name of SESSION_COOKIE_NAMES) jar.delete(name);
}

/** Alle Sessions eines Benutzers beenden (z. B. nach Passwortänderung/Deaktivierung). */
export async function revokeSessions(userId: string, exceptCurrent = false) {
  let keep: string | undefined;
  if (exceptCurrent) {
    const jar = await cookies();
    const token = readSessionToken((name) => jar.get(name));
    keep = token ? sha256(token) : undefined;
  }
  await db.session.deleteMany({ where: { userId, ...(keep ? { NOT: { tokenHash: keep } } : {}) } });
}

/** Aktuelle Sitzung inkl. effektiver Berechtigungen (pro Request gecacht). */
export const getSession = cache(async (): Promise<AppSession | null> => {
  const jar = await cookies();
  const token = readSessionToken((name) => jar.get(name));
  if (!token) return null;

  const row = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: {
      user: {
        include: { roles: { include: { role: { include: { permissions: true } } } } },
      },
    },
  });
  if (!row || row.expiresAt < new Date() || !row.user.active) return null;

  // lastUsedAt höchstens alle 10 Minuten schreiben
  if (Date.now() - row.lastUsedAt.getTime() > 10 * 60_000) {
    await db.session.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  }

  const roles = row.user.roles.map((r) => r.role);
  const isAdmin = roles.some((r) => r.isAdmin);
  // Ausgeschaltete Funktionen: ihre Rechte fallen für alle weg (auch für Administratoren).
  // Da jede Seite, Action und API-Route über Rechte schützt, sperrt das die Funktion überall.
  const features = await getActiveFeatureIds();
  const granted: string[] = isAdmin ? ALL_PERMISSIONS : roles.flatMap((r) => r.permissions.map((p) => p.permission));
  const permissions = new Set(granted.filter((p) => features.has(featureOfPermission(p) ?? "")));
  const u = row.user;
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
    },
    features,
    permissions,
    can: (p) => permissions.has(p),
  };
});

/**
 * Für Server Components/Actions: Login erzwingen. Benutzer mit `mustChangePassword` werden zur
 * Kontoseite umgeleitet (außer dort: `allowPasswordChange`).
 */
export async function requireSession(opts: { allowPasswordChange?: boolean } = {}): Promise<AppSession> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.user.mustChangePassword && !opts.allowPasswordChange) redirect("/account");
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
