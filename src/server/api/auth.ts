import "server-only";
import { ipInNets, netsOf } from "@/lib/api/cidr";
import { problemOf } from "@/lib/api/problem";
import { effectivePermissions } from "@/lib/api/scope";
import { bearerToken, hashApiToken, tokenHint } from "@/lib/api/token";
import { clientIp } from "@/lib/client-ip";
import { ALL_PERMISSIONS, featureOfPermission, type Permission } from "@/modules/catalog";
import { getActiveFeatureIds } from "@/modules/features";
import { isBehindProxy } from "@/server/auth/network";
import { authPolicy } from "@/server/auth/policy";
import type { AppSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { problemResponse, setApiAuthenticator, type ApiAuthResult } from "@/server/operations";
import { apiLimiters, apiLimits, apiRuntime } from "./state";

/**
 * Authentifizierung von `/api/v1`: ausschließlich `Authorization: Bearer <token>`. Das Sitzungs-Cookie wird hier nie gelesen (und umgekehrt
 * akzeptieren UI-Aktionen und Seiten nie ein Token – sie lesen nur das Cookie).
 *
 * Ablauf: Form prüfen → Hash-Lookup → Token gültig? (nicht widerrufen, nicht abgelaufen, Besitzer aktiv und ohne ausstehenden Passwortwechsel).
 * **Nur wenn das scheitert**, greift die Drosselung des Fehlerpfads (global, je Adresse nur hinter dem Reverse-Proxy, ohne scrypt, nur ein Zähler im
 * Speicher). Ein gültiges Token wird davon nie berührt: Eine Flut ungültiger Tokens kann berechtigte Aufrufer nicht ausbremsen.
 * Alle Ablehnungsgründe (unbekannt, abgelaufen, widerrufen, Besitzer gesperrt) sehen von außen gleich aus.
 */

/** „zuletzt benutzt“ höchstens alle 10 Minuten schreiben (kein Schreibzugriff je Anfrage). */
const LAST_USED_EVERY_MS = 10 * 60_000;

const challenge = { "www-authenticate": 'Bearer realm="schrauberos"' };

/** Ungültiges Token: 401 – oder 429, wenn die Fehlversuche überhandnehmen (nur dieser Pfad). */
async function reject(request: Request): Promise<ApiAuthResult> {
  // Zuerst das billige globale Budget (nur ein Zähler); die Proxy-Einstellung (eine Datenbankabfrage) erst, wenn es nicht schon reicht
  const global = apiLimiters.failuresGlobal.hit("all", apiLimits.failuresGlobal);
  let wait = global.allowed ? 0 : global.resetSeconds;
  if (global.allowed) {
    const ip = clientIp(request.headers.get("x-forwarded-for"), await isBehindProxy());
    const perIp = ip ? apiLimiters.failuresPerIp.hit(ip, apiLimits.failuresPerIp) : null;
    if (perIp && !perIp.allowed) wait = perIp.resetSeconds;
  }
  if (wait > 0) return { ok: false, response: problemResponse(problemOf("rate_limited"), { "retry-after": String(wait) }) };
  return { ok: false, response: problemResponse(problemOf("unauthenticated"), challenge) };
}

export async function authenticateApiRequest(request: Request): Promise<ApiAuthResult> {
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return reject(request);

  const row = await db.apiToken.findUnique({
    where: { tokenHash: hashApiToken(token) },
    include: { scope: true, user: { include: { roles: { include: { role: { include: { permissions: true } } } }, twoFactor: { select: { enabledAt: true } } } } },
  });
  const now = apiRuntime.now();
  if (!row || row.revokedAt || row.expiresAt.getTime() <= now || !row.user.active || row.user.mustChangePassword) return reject(request);
  // Verlangt die Richtlinie den zweiten Faktor für Administratoren, gilt das auch für ihre Tokens: Ein Administrator-Konto, das ihn noch nicht eingerichtet hat, darf die Pflicht
  // nicht über die Programmierschnittstelle umgehen (die Sitzung kommt nur bis „Mein Konto“) – sein Token wird bis zur Einrichtung abgelehnt, nicht widerrufen.
  if (row.user.roles.some((r) => r.role.isAdmin) && !row.user.twoFactor?.enabledAt && (await authPolicy()).requireTwoFactorForAdmins) return reject(request);
  // Optionale Beschränkung auf Adressbereiche: gilt nur mit der Einstellung „Hinter Reverse-Proxy“ (sonst kennen wir die Adresse des Aufrufers nicht, und der Header wäre fälschbar) – ohne bekannte
  // Adresse bleibt ein beschränktes Token zu (fail-closed). Von außen sieht es aus wie jedes ungültige Token (401, Drosselung im Fehlerpfad).
  if (row.allowedNets) {
    const ip = clientIp(request.headers.get("x-forwarded-for"), await isBehindProxy());
    if (!ipInNets(ip, netsOf(row.allowedNets))) return reject(request);
  }

  if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > LAST_USED_EVERY_MS) {
    // atomar und ohne updatedAt: gleichzeitige Anfragen schreiben höchstens einmal
    await db.apiToken
      .updateMany({ where: { id: row.id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now - LAST_USED_EVERY_MS) } }] }, data: { lastUsedAt: new Date(now) } })
      .catch(() => undefined);
  }

  // Aktuelle Rechte des Besitzers (wie in der Sitzung: auf aktive Funktionen eingeschränkt), geschnitten mit dem Scope des Tokens
  const features = await getActiveFeatureIds();
  const roles = row.user.roles.map((r) => r.role);
  const granted: string[] = roles.some((r) => r.isAdmin) ? ALL_PERMISSIONS : roles.flatMap((r) => r.permissions.map((p) => p.permission));
  const owner = new Set(granted.filter((p) => features.has(featureOfPermission(p) ?? "")));
  const permissions = effectivePermissions(
    row.scope.map((s) => s.permission),
    owner,
  );

  const u = row.user;
  const principal: AppSession = {
    // Ein API-Principal ist nie Administrator und trägt keine Rollen: nichts, was an Rollen hängt, kann über ein Token ausgelöst werden
    user: { id: u.id, username: u.username, name: u.name, email: u.email, locale: null, theme: null, authSource: u.authSource, mustChangePassword: false, isAdmin: false, roleNames: [], roleIds: [], twoFactor: false, mustSetupTwoFactor: false },
    features,
    permissions,
    can: (permission: Permission) => permissions.has(permission),
    apiToken: { id: row.id, name: row.name, hint: row.hint || tokenHint(token) },
  };
  return { ok: true, principal, token: { id: row.id, rateLimitPerMinute: row.rateLimitPerMinute } };
}

setApiAuthenticator(authenticateApiRequest);
