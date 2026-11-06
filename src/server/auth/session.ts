import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { db } from "@/server/db";
import { getAuthProvider } from "./providers";
import { verifyPassword } from "./password";
import { isLocale, LOCALE_COOKIE, THEME_COOKIE, type Locale } from "@/i18n/config";
import { THEMES, type Theme } from "@/lib/constants";
import { ALL_PERMISSIONS, featureOfPermission, type Permission } from "@/modules/catalog";
import { getActiveFeatureIds } from "@/modules/features";

export const SESSION_COOKIE = "so_session";
const SESSION_DAYS = 14;
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

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
};

export type AppSession = {
  user: SessionUser;
  /** Aktive (nicht ausgeschaltete) Funktionen, z. B. "workshop.tires" */
  features: ReadonlySet<string>;
  /** Effektive Rechte: die Rollen des Benutzers, eingeschränkt auf aktive Funktionen */
  permissions: ReadonlySet<string>;
  can: (permission: Permission) => boolean;
};

export type LoginResult =
  | { ok: true; mustChangePassword: boolean }
  | { ok: false; reason: "invalid" | "locked" | "inactive" };

export async function login(username: string, password: string): Promise<LoginResult> {
  const user = await db.user.findUnique({ where: { username: username.trim().toLowerCase() } });
  const provider = user ? getAuthProvider(user.authSource) : null;

  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    return { ok: false, reason: "locked" };
  }

  // Immer einen Hash prüfen (auch bei unbekanntem Benutzer) -> kein Timing-Orakel.
  const valid = user && provider ? await provider.verify(user, password) : await verifyPassword(password, null);

  if (!user || !valid) {
    if (user) {
      const failed = user.failedLogins + 1;
      await db.user.update({
        where: { id: user.id },
        data:
          failed >= MAX_FAILED_LOGINS
            ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) }
            : { failedLogins: failed },
      });
    }
    return { ok: false, reason: "invalid" };
  }
  if (!user.active) return { ok: false, reason: "inactive" };

  await db.user.update({
    where: { id: user.id },
    data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await startSession(user.id);

  // Persönliche Einstellungen in Cookies spiegeln (Server rendert damit ohne DB-Zugriff)
  const jar = await cookies();
  const opts = { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" as const };
  if (isLocale(user.locale)) jar.set(LOCALE_COOKIE, user.locale, opts);
  if (user.theme && (THEMES as readonly string[]).includes(user.theme)) jar.set(THEME_COOKIE, user.theme, opts);

  return { ok: true, mustChangePassword: user.mustChangePassword };
}

async function startSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
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
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: await secureCookies(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(SESSION_COOKIE);
}

/** Alle Sessions eines Benutzers beenden (z. B. nach Passwortänderung/Deaktivierung). */
export async function revokeSessions(userId: string, exceptCurrent = false) {
  let keep: string | undefined;
  if (exceptCurrent) {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    keep = token ? sha256(token) : undefined;
  }
  await db.session.deleteMany({ where: { userId, ...(keep ? { NOT: { tokenHash: keep } } : {}) } });
}

/** Aktuelle Sitzung inkl. effektiver Berechtigungen (pro Request gecacht). */
export const getSession = cache(async (): Promise<AppSession | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
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
