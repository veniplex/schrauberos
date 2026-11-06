import "server-only";
import { z } from "zod";
import { checkTokenScope } from "@/lib/api/scope";
import { generateApiToken, hashApiToken, tokenHint } from "@/lib/api/token";
import { db } from "@/server/db";
import { defineOperation, fail, failField } from "@/server/operations";
import { loadActor } from "@/server/rbac/hierarchy";
import { apiRuntime } from "./state";

/**
 * API-Tokens verwalten (Server-Funktionen; die Oberfläche folgt mit F11, „API & Webhooks“).
 *
 *  - Erzeugen nur **per Sitzung** und nur mit dem Verwaltungsrecht `settings.manage` (adminOnly) – ein Token kann nie ein Token erzeugen, denn Tokens
 *    tragen kein adminOnly-Recht (`isApiForbidden`). F11 ersetzt das Recht durch `api.manage` und verlangt in `prepare` die erneute Passwortabfrage.
 *  - Rechte-Hierarchie: Der Scope darf höchstens die Rechte enthalten, die der Erzeuger selbst hat (Rohrechte, frisch aus der Datenbank in derselben
 *    Transaktion); nie gesperrte Rechte (adminOnly, Verwaltung, sensible Mitarbeiterdaten).
 *  - Das Klartext-Token steht **nur** im Ergebnis der Erzeugung (nie im Audit-Log, nie in Logs). Gespeichert wird der SHA-256-Hash.
 *  - Besitzer ist der Erzeuger. Ablauf ist Pflicht (höchstens 365 Tage).
 */
export const TOKEN_MAX_DAYS = 365;
export const TOKEN_DEFAULT_DAYS = 90;
export const TOKEN_DEFAULT_RATE = 120;
export const TOKEN_MAX_RATE = 6000;

const createInput = z.object({
  name: z.string().trim().min(1).max(50),
  scope: z.array(z.string().min(1).max(60)).min(1).max(100),
  expiresInDays: z.coerce.number().int().min(1).max(TOKEN_MAX_DAYS).default(TOKEN_DEFAULT_DAYS),
  rateLimitPerMinute: z.coerce.number().int().min(1).max(TOKEN_MAX_RATE).default(TOKEN_DEFAULT_RATE),
});

export const createApiTokenOperation = defineOperation({
  name: "apiTokens.create",
  permission: "settings.manage",
  input: createInput,
  audit: "apiToken.create",
  prepare: async () => {
    const token = generateApiToken();
    return { token, hash: hashApiToken(token), hint: tokenHint(token) };
  },
  run: async ({ input, principal, prepared, tx, audit }) => {
    // Nur eine Sitzung erzeugt Tokens (zusätzlich zur Rechteprüfung: ein API-Principal trägt kein adminOnly-Recht)
    if (principal.apiToken) fail("forbidden");
    const actor = await loadActor(tx, principal.user.id);
    const scope = [...new Set(input.scope)];
    const denial = checkTokenScope(actor, scope);
    if (denial) failField("scope", denial === "notSubset" ? "api.errors.scopeNotSubset" : denial === "forbidden" ? "api.errors.scopeForbidden" : "validation.invalid");

    const expiresAt = new Date(apiRuntime.now() + input.expiresInDays * 86_400_000);
    const row = await tx.apiToken.create({
      data: {
        name: input.name,
        tokenHash: prepared.hash,
        hint: prepared.hint,
        userId: principal.user.id,
        expiresAt,
        createdByName: principal.user.name,
        rateLimitPerMinute: input.rateLimitPerMinute,
        scope: { create: scope.map((permission) => ({ permission })) },
      },
      select: { id: true },
    });
    audit({ target: `${input.name} (${prepared.hint})`, entityId: row.id });
    // Das Klartext-Token verlässt die Operation nur in diesem Ergebnis
    return { id: row.id, token: prepared.token, hint: prepared.hint, expiresAt };
  },
});

export const revokeApiTokenOperation = defineOperation({
  name: "apiTokens.revoke",
  permission: "settings.manage",
  input: z.object({ id: z.string().min(1) }),
  audit: "apiToken.revoke",
  run: async ({ input, principal, tx, audit }) => {
    if (principal.apiToken) fail("forbidden");
    const token = await tx.apiToken.findUnique({ where: { id: input.id }, select: { name: true, hint: true, revokedAt: true } });
    if (!token) fail("notFound");
    if (!token.revokedAt) await tx.apiToken.update({ where: { id: input.id }, data: { revokedAt: new Date(apiRuntime.now()) } });
    audit({ target: `${token.name} (${token.hint})`, entityId: input.id });
    return { id: input.id };
  },
});

export type ApiTokenInfo = {
  id: string;
  name: string;
  hint: string;
  userId: string;
  scope: string[];
  expiresAt: Date;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  rateLimitPerMinute: number;
};

/** Alle Tokens (ohne Hash) für die spätere Verwaltungsoberfläche. */
export async function listApiTokens(): Promise<ApiTokenInfo[]> {
  const rows = await db.apiToken.findMany({ include: { scope: true }, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    hint: r.hint,
    userId: r.userId,
    scope: r.scope.map((s) => s.permission).sort(),
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
    revokedAt: r.revokedAt,
    rateLimitPerMinute: r.rateLimitPerMinute,
  }));
}

/** Aufräumen (Scheduler): abgelaufene Idempotenz-Schlüssel und Tokens, die seit mehr als 90 Tagen abgelaufen oder widerrufen sind. */
export async function pruneApiTokens(now = apiRuntime.now()): Promise<number> {
  const cutoff = new Date(now - 90 * 86_400_000);
  const { count } = await db.apiToken.deleteMany({ where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] } });
  return count;
}
