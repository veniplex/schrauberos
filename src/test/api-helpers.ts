/**
 * Hilfen für API-Tests: legt Tokens direkt in der Testdatenbank an (auch abgelaufene/widerrufene) und ruft die Pipeline wie ein Client auf.
 * Der zu testende Code (`@/server/api/router`) wird erst nach `createTestEnv()` geladen.
 */
import { generateApiToken, hashApiToken, tokenHint } from "@/lib/api/token";
import type { TestEnv } from "@/test/harness";

export type TokenOptions = {
  /** Rechte der Rolle des Besitzers (oder `admin: true`) */
  ownerPermissions?: readonly string[];
  admin?: boolean;
  /** Scope des Tokens (Standard: alle Rechte des Besitzers, die ein Token tragen darf – hier ausdrücklich angegeben) */
  scope: readonly string[];
  expiresAt?: Date;
  revokedAt?: Date | null;
  ownerActive?: boolean;
  ownerMustChangePassword?: boolean;
  rateLimitPerMinute?: number;
  name?: string;
  /** vorhandenen Besitzer verwenden */
  ownerId?: string;
};

let seq = 0;

export async function makeToken(env: TestEnv, options: TokenOptions): Promise<{ token: string; id: string; userId: string }> {
  const n = ++seq;
  let userId = options.ownerId;
  if (!userId) {
    const role = await env.role({ key: `api-${n}`, isAdmin: options.admin, permissions: options.ownerPermissions ?? [] });
    const user = await env.user({ username: `api-owner-${n}`, name: `API Besitzer ${n}`, active: options.ownerActive ?? true, mustChangePassword: options.ownerMustChangePassword, roles: [role] });
    userId = user.id;
  }
  const token = generateApiToken();
  const row = await env.db.apiToken.create({
    data: {
      name: options.name ?? `Token ${n}`,
      tokenHash: hashApiToken(token),
      hint: tokenHint(token),
      userId,
      expiresAt: options.expiresAt ?? new Date(Date.now() + 30 * 86_400_000),
      revokedAt: options.revokedAt ?? null,
      rateLimitPerMinute: options.rateLimitPerMinute ?? 120,
      scope: { create: options.scope.map((permission) => ({ permission })) },
    },
  });
  return { token, id: row.id, userId };
}

export type ApiInit = { token?: string | null; body?: unknown; raw?: string; headers?: Record<string, string>; contentType?: string | null };

/** Eine Anfrage an `/api/v1<path>` (ohne Token, wenn `token` fehlt). */
export function apiRequest(method: string, path: string, init: ApiInit = {}): Request {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  let body: string | undefined;
  if (init.raw !== undefined) body = init.raw;
  else if (init.body !== undefined) body = JSON.stringify(init.body);
  if (body !== undefined && init.contentType !== null) headers.set("content-type", init.contentType ?? "application/json");
  return new Request(`http://localhost/api/v1${path}`, { method, headers, body });
}
