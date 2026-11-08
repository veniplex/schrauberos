import "server-only";
import { isExplicitOnly } from "@/modules/catalog";
import { writeAudit } from "@/server/audit";
import { auditActorName, type Principal, type Tx } from "@/server/operations";
import { holdingsOfPermission, withHoldings, type Holding } from "@/server/secret-holdings";

/**
 * Vergabe **ausdrücklich zu vergebender Rechte** (`explicitOnly`, z. B. IT-Tresor) im Audit-Log: `role.update`/`user.update` nennen nur den Namen. Wer sich eine Rolle um das Tresor-Recht erweitert und sie sich
 * selbst gibt (ein Administrator darf das, die Kontrolle ist allein das Audit-Log), soll das nicht hinter einem Rollennamen verstecken können. Deshalb schreibt jede Änderung, die ein solches Recht hinzufügt
 * oder entzieht, **je Recht einen eigenen Eintrag** – in derselben Transaktion wie die Änderung (nur Rechtenamen, nie Rechtemengen):
 *  - `role.explicitGrant`/`role.explicitRevoke`: Rolle und Recht (neue Rolle: alle ihre ausdrücklichen Rechte sind „vergeben“),
 *  - `user.explicitGrant`/`user.explicitRevoke`: Konto, Rolle und Recht (eine Rolle mit ausdrücklichen Rechten wurde dem Konto gegeben oder entzogen; neues Konto: alle seine Rollen).
 * Gibt es abhängige Einträge (Tresor-Einträge), steht das im Eintrag (`Tresor betroffen (n Einträge)`).
 */
type Actor = Pick<Principal, "user" | "apiToken">;
const actorOf = (principal: Actor) => ({ id: principal.user.id, name: auditActorName(principal as Principal) });

export const explicitOf = (permissions: readonly string[]): string[] => permissions.filter(isExplicitOnly).sort();

/** Rolle geändert (`before`: bisherige Rechte, leer bei neuer Rolle; `after`: neue Rechte) */
export async function auditRoleExplicitChange(tx: Tx, principal: Actor, role: { id: string; name: string }, before: readonly string[], after: readonly string[], holdings: readonly Holding[]): Promise<void> {
  const was = new Set(explicitOf(before));
  const now = new Set(explicitOf(after));
  const write = (action: "role.explicitGrant" | "role.explicitRevoke", permission: string) =>
    writeAudit(tx, action, { actor: actorOf(principal), target: withHoldings(`${role.name}: ${permission}`, holdingsOfPermission(holdings, permission)), entityId: role.id });
  for (const permission of now) if (!was.has(permission)) await write("role.explicitGrant", permission);
  for (const permission of was) if (!now.has(permission)) await write("role.explicitRevoke", permission);
}

type RoleOfUser = { id: string; name: string; permissions: readonly string[] };

/** Rollen eines Kontos geändert (`before`/`after`: die Rollen mit ihren Rechten; bei einem neuen Konto ist `before` leer) */
export async function auditUserExplicitChange(tx: Tx, principal: Actor, user: { id: string; username: string }, before: readonly RoleOfUser[], after: readonly RoleOfUser[], holdings: readonly Holding[]): Promise<void> {
  const beforeIds = new Set(before.map((r) => r.id));
  const afterIds = new Set(after.map((r) => r.id));
  const emit = async (action: "user.explicitGrant" | "user.explicitRevoke", role: RoleOfUser) => {
    for (const permission of explicitOf(role.permissions)) {
      await writeAudit(tx, action, { actor: actorOf(principal), target: withHoldings(`${user.username} ← ${role.name}: ${permission}`, holdingsOfPermission(holdings, permission)), entityId: user.id });
    }
  };
  for (const role of after) if (!beforeIds.has(role.id)) await emit("user.explicitGrant", role);
  for (const role of before) if (!afterIds.has(role.id)) await emit("user.explicitRevoke", role);
}
