import "server-only";
import { z } from "zod";
import { parseNetList } from "@/lib/api/cidr";
import { checkTokenScope } from "@/lib/api/scope";
import { generateApiToken, hashApiToken, tokenHint } from "@/lib/api/token";
import { MARKED_PERMISSIONS } from "@/modules/catalog";
import { confirmOwnPassword } from "@/server/auth/confirm-password";
import { isBehindProxy } from "@/server/auth/network";
import { db } from "@/server/db";
import { defineOperation, fail, failField } from "@/server/operations";
import { loadActor } from "@/server/rbac/hierarchy";
import { apiRuntime } from "./state";

/**
 * API-Tokens verwalten (Operationen; die Oberfläche steht in `modules/admin/api`, Funktion „API & Webhooks“).
 *
 *  - Erzeugen nur **per Sitzung**, nur mit dem Verwaltungsrecht `api.manage` (adminOnly) **und erneuter Passwortabfrage** der handelnden Person (`confirmOwnPassword`, in `prepare`) – ein Token kann nie ein Token
 *    erzeugen, denn Tokens tragen kein adminOnly-Recht (`isApiForbidden`) und die Operation lehnt einen API-Principal ausdrücklich ab. Widerrufen braucht keine Passwortabfrage (es verengt nur).
 *  - Rechte-Hierarchie: Der Scope darf höchstens die Rechte enthalten, die der Erzeuger selbst hat (Rohrechte, frisch aus der Datenbank in derselben
 *    Transaktion); nie gesperrte Rechte (adminOnly, Verwaltung, sensible Mitarbeiterdaten). Rechte mit Kennzeichnung (Versand, Festschreiben …) gehen nur mit ausdrücklicher Bestätigung
 *    (`acknowledgeMarked`) in einen Scope: Sie lösen Unumkehrbares oder Ausgehendes aus.
 *  - Optional: Beschränkung auf Adressbereiche (CIDR). Sie wirkt nur mit der Einstellung „Hinter Reverse-Proxy“ (sonst ließe sich der Header fälschen); ohne sie wird die Beschränkung beim Anlegen abgelehnt.
 *  - Das Klartext-Token steht **nur** im Ergebnis der Erzeugung (nie im Audit-Log, nie in Logs). Gespeichert wird der SHA-256-Hash.
 *  - Besitzer ist der Erzeuger. Ablauf ist Pflicht (höchstens 365 Tage).
 */
export const TOKEN_MAX_DAYS = 365;
export const TOKEN_DEFAULT_DAYS = 90;
export const TOKEN_DEFAULT_RATE = 120;
export const TOKEN_MAX_RATE = 6000;

const passwordField = z.string().max(1024);
const nameField = z.string().trim().min(1).max(50);
const descriptionField = z.string().trim().max(200).default("");
const rateField = z.coerce.number().int().min(1).max(TOKEN_MAX_RATE).default(TOKEN_DEFAULT_RATE);

const createInput = z.object({
  name: nameField,
  description: descriptionField,
  scope: z.array(z.string().min(1).max(60)).min(1).max(100),
  expiresInDays: z.coerce.number().int().min(1).max(TOKEN_MAX_DAYS).default(TOKEN_DEFAULT_DAYS),
  rateLimitPerMinute: rateField,
  /** Adressbereiche (CIDR; Zeilen oder Komma getrennt), leer = keine Beschränkung */
  allowedNets: z.string().max(2000).default(""),
  /** Ausdrückliche Bestätigung, wenn der Scope gekennzeichnete Rechte enthält (Versand, Festschreiben …) */
  acknowledgeMarked: z.boolean().default(false),
  /** Passwort der handelnden Person (erneute Abfrage) */
  password: passwordField,
});

/** Beschränkung prüfen: gültige Einträge, höchstens `MAX_NETS`, und nur mit der Proxy-Einstellung wirksam. Liefert die Textform zum Speichern (`null` = keine). */
async function checkNets(input: string): Promise<string | null> {
  const parsed = parseNetList(input);
  if (!parsed.ok) failField("allowedNets", parsed.reason === "tooMany" ? "api.errors.netTooMany" : "api.errors.netInvalid", parsed.entry ? { entry: parsed.entry } : undefined);
  if (parsed.nets.length > 0 && !(await isBehindProxy())) failField("allowedNets", "api.errors.netNeedsProxy");
  return parsed.text;
}

export const createApiTokenOperation = defineOperation({
  name: "apiTokens.create",
  permission: "api.manage",
  input: createInput,
  audit: "apiToken.create",
  prepare: async ({ input, principal }) => {
    // Ein Token erzeugt nie ein Token – und rechnet deshalb auch kein Passwort (kein Weg, den Eigentümer-Pfad zu belasten)
    if (principal.apiToken) fail("forbidden");
    await confirmOwnPassword(principal.user.id, input.password);
    const token = generateApiToken();
    return { token, hash: hashApiToken(token), hint: tokenHint(token), nets: await checkNets(input.allowedNets) };
  },
  run: async ({ input, principal, prepared, tx, audit }) => {
    // Nur eine Sitzung erzeugt Tokens (zusätzlich zur Rechteprüfung: ein API-Principal trägt kein adminOnly-Recht)
    if (principal.apiToken) fail("forbidden");
    const actor = await loadActor(tx, principal.user.id);
    const scope = [...new Set(input.scope)];
    const denial = checkTokenScope(actor, scope);
    if (denial) failField("scope", denial === "notSubset" ? "api.errors.scopeNotSubset" : denial === "forbidden" ? "api.errors.scopeForbidden" : "validation.invalid");
    if (scope.some((p) => MARKED_PERMISSIONS.has(p)) && !input.acknowledgeMarked) failField("acknowledgeMarked", "api.errors.markedNeedsAck");

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
        description: input.description || null,
        allowedNets: prepared.nets,
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
  permission: "api.manage",
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
  description: string | null;
  hint: string;
  userId: string;
  ownerName: string;
  allowedNets: string | null;
  scope: string[];
  expiresAt: Date;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  rateLimitPerMinute: number;
};

/** Alle Tokens (ohne Hash) für die Verwaltungsoberfläche. */
export async function listApiTokens(): Promise<ApiTokenInfo[]> {
  const rows = await db.apiToken.findMany({ include: { scope: true, user: { select: { name: true } } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    hint: r.hint,
    userId: r.userId,
    ownerName: r.user.name,
    allowedNets: r.allowedNets,
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
