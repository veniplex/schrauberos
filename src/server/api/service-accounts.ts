import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { MessageKey } from "@/i18n/translate";
import { checkGrantRole, type Denial } from "@/lib/rbac";
import { isAdminOnly } from "@/modules/catalog";
import { confirmOwnPassword } from "@/server/auth/confirm-password";
import { SERVICE_SOURCE } from "@/server/auth/providers";
import { revokeAccess } from "@/server/auth/revoke";
import { db } from "@/server/db";
import { defineOperation, fail, failField } from "@/server/operations";
import { loadActor, loadRoles } from "@/server/rbac/hierarchy";

/**
 * **Dienstkonten** für Integrationen (Buchhaltung, Portal): ein Konto, das **nur** API-Tokens trägt – plankonform („Service-Konten haben kein Passwort, keine Anmeldung und können keine Rollen ändern“).
 *
 *  - Ein Dienstkonto ist ein Benutzer mit `authSource = "service"` und **ohne Passwort**: Anmeldung, Notzugang, bekanntes Gerät, Passwort setzen/zurücksetzen und zweiter Faktor gibt es für das Konto nicht
 *    (`getAuthProvider` kennt keinen Anbieter, `completeLogin`/`getSession` verweigern es zusätzlich; `confirmOwnPassword` und alle Konto-Aktionen verlangen eine lokale Quelle). `mustChangePassword` ist nie gesetzt.
 *  - **Rollen:** nur vorhandene Rollen ohne Administrator-Flag und ohne Rechte der Verwaltung (`adminOnly`), und nur solche, die der Erzeuger vollständig besitzt (Rechte-Hierarchie `checkGrantRole`, gleiche Prüfung
 *    wie bei Benutzern – nie mehr Rechte als der Erzeuger). Das Konto kann weder Benutzer noch Rollen noch Einstellungen ändern: Es hat keine Sitzung, und kein Token trägt ein Verwaltungsrecht (`isApiForbidden`).
 *  - **Tokens** (`apiTokens.create`, Besitzer wählbar) hängen am Dienstkonto, nicht am Erzeuger: Passwortwechsel, „Überall abmelden“ und Notzugang des Erzeugers lassen sie unberührt. Ihre Rechte sind
 *    Scope ∩ Rechte des **Kontos** (Rollen), bei jeder Anfrage. Beenden: Deaktivieren/Löschen des Dienstkontos (alle Tokens enden sofort) oder einzelne Tokens widerrufen.
 *  - Verwalten nur per Sitzung mit `api.manage` (adminOnly); Anlegen und Wiedereinschalten mit erneuter Passwortabfrage (sie erweitern, was Tokens können); Audit mit dem Erzeuger als Akteur.
 *  - Zwei-Faktor-Pflicht für Administratoren (`requireTwoFactorForAdmins`) gilt für Tokens von Administratoren – Dienstkonten sind keine Administratoren und haben keine Sitzung, daher nicht betroffen.
 */
export const MAX_SERVICE_ACCOUNTS = 20;

const deniedKey = (denial: Denial) => `rbac.denied.${denial}` as MessageKey;

const nameField = z.string().trim().min(1).max(60);

/** Anmeldename des Kontos (nie benutzbar, aber eindeutig und erkennbar): `svc-<kurzer Name>-<Zufall>`. */
async function freshUsername(tx: Pick<typeof db, "user">, name: string): Promise<string> {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);
  for (let attempt = 0; attempt < 10; attempt++) {
    const username = `svc-${slug || "konto"}-${randomBytes(3).toString("hex")}`;
    if (!(await tx.user.findUnique({ where: { username }, select: { id: true } }))) return username;
  }
  return `svc-${randomBytes(8).toString("hex")}`;
}

export const createServiceAccountOperation = defineOperation({
  name: "apiServiceAccounts.create",
  permission: "api.manage",
  input: z.object({
    name: nameField,
    roleIds: z.array(z.string().min(1).max(40)).min(1).max(20),
    /** Passwort der handelnden Person (erneute Abfrage) */
    password: z.string().max(1024),
  }),
  audit: "serviceAccount.create",
  prepare: async ({ input, principal }) => {
    // Ein Token erzeugt nie ein Dienstkonto (und rechnet kein Passwort)
    if (principal.apiToken) fail("forbidden");
    await confirmOwnPassword(principal.user.id, input.password);
  },
  run: async ({ input, principal, tx, audit }) => {
    if (principal.apiToken) fail("forbidden");
    if ((await tx.user.count({ where: { authSource: SERVICE_SOURCE } })) >= MAX_SERVICE_ACCOUNTS) fail("invalid", "api.accounts.errors.tooMany", { max: MAX_SERVICE_ACCOUNTS });
    const actor = await loadActor(tx, principal.user.id);
    const roleIds = [...new Set(input.roleIds)];
    const roles = await loadRoles(tx, roleIds);
    if (roles.length !== roleIds.length) failField("roleIds", "validation.invalid");
    for (const role of roles) {
      // Nie eine Administrator-Rolle und nie Rechte der Verwaltung – auch nicht, wenn der Erzeuger Administrator ist
      if (role.isAdmin || role.permissions.some(isAdminOnly)) failField("roleIds", "api.accounts.errors.adminRole");
      const denied = checkGrantRole(actor, role);
      if (denied) fail("forbidden", deniedKey(denied));
    }
    const username = await freshUsername(tx, input.name);
    const created = await tx.user.create({
      data: { username, name: input.name, passwordHash: null, authSource: SERVICE_SOURCE, active: true, mustChangePassword: false, roles: { create: roles.map((r) => ({ roleId: r.id })) } },
      select: { id: true },
    });
    audit({ target: `${input.name} (${username})`, entityId: created.id });
    return { id: created.id };
  },
});

/** Ein- und Ausschalten (Ausschalten beendet alle Tokens des Kontos sofort; Einschalten verlangt das Passwort: Die Tokens bleiben widerrufen, neue lassen sich erzeugen). */
export const setServiceAccountActiveOperation = defineOperation({
  name: "apiServiceAccounts.setActive",
  permission: "api.manage",
  input: z.object({ id: z.string().min(1).max(40), active: z.boolean(), password: z.string().max(1024).default("") }),
  audit: (input) => (input.active ? "serviceAccount.enable" : "serviceAccount.disable"),
  prepare: async ({ input, principal }) => {
    if (principal.apiToken) fail("forbidden");
    if (input.active) await confirmOwnPassword(principal.user.id, input.password);
  },
  run: async ({ input, principal, tx, audit }) => {
    if (principal.apiToken) fail("forbidden");
    const account = await tx.user.findUnique({ where: { id: input.id }, select: { id: true, username: true, name: true, authSource: true, active: true } });
    if (!account || account.authSource !== SERVICE_SOURCE) fail("notFound");
    if (account.active !== input.active) {
      await tx.user.update({ where: { id: account.id }, data: { active: input.active } });
      // Ausschalten: alle Tokens des Kontos enden in derselben Transaktion
      if (!input.active) await revokeAccess(tx, account.id);
    }
    audit({ target: `${account.name} (${account.username})`, entityId: account.id });
    return { id: account.id };
  },
});

export const deleteServiceAccountOperation = defineOperation({
  name: "apiServiceAccounts.delete",
  permission: "api.manage",
  input: z.object({ id: z.string().min(1).max(40) }),
  audit: "serviceAccount.delete",
  run: async ({ input, principal, tx, audit }) => {
    if (principal.apiToken) fail("forbidden");
    const account = await tx.user.findUnique({ where: { id: input.id }, select: { id: true, username: true, name: true, authSource: true } });
    if (!account || account.authSource !== SERVICE_SOURCE) fail("notFound");
    // Die Tokens des Kontos gehen mit (Fremdschlüssel mit Cascade); Zuweisungen/Anlagen verlieren ihren Verweis (SetNull)
    await tx.user.delete({ where: { id: account.id } });
    audit({ target: `${account.name} (${account.username})`, entityId: account.id });
    return { id: account.id };
  },
});

export type ServiceAccountInfo = { id: string; name: string; username: string; active: boolean; createdAt: Date; roleNames: string[]; activeTokens: number };

/** Alle Dienstkonten für die Verwaltungsoberfläche (ohne Rechte-Rohdaten). */
export async function listServiceAccounts(): Promise<ServiceAccountInfo[]> {
  const rows = await db.user.findMany({
    where: { authSource: SERVICE_SOURCE },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, name: true, username: true, active: true, createdAt: true, roles: { select: { role: { select: { name: true } } } }, apiTokens: { where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { id: true } } },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, username: r.username, active: r.active, createdAt: r.createdAt, roleNames: r.roles.map((x) => x.role.name).sort(), activeTokens: r.apiTokens.length }));
}
