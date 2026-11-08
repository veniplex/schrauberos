import "server-only";
import { writeAudit } from "@/server/audit";
import { auditActorName, type Principal, type Tx } from "@/server/operations";

/**
 * Audit der Rechte- und Rollenänderungen (Z6-1 M3): `role.update` und `user.update` nennen nur den Namen und sind von einer reinen Umbenennung nicht zu unterscheiden. Wer einer Rolle `users.manage`
 * oder `api.manage` gibt oder einem Konto die Rolle „Administrator“, soll das im Audit-Log **sehen** – deshalb schreibt jede Änderung, die Rechte einer Rolle (`role.permissionsChanged`) oder
 * die Rollen eines Kontos (`user.rolesChanged`) verändert, einen eigenen Eintrag mit der Differenz, in derselben Transaktion: `+` hinzugefügt, `−` entzogen. Bei Rollen nur Rechte-**Schlüssel**,
 * bei Konten nur Rollen**namen** (keine Personendaten außer Konto- und Rollenname); mehr als `CHANGE_AUDIT_LIMIT` Einträge werden gekürzt („…und n weitere“).
 */
export const CHANGE_AUDIT_LIMIT = 20;
/** Obergrenze der Länge des Zielfelds für diese Einträge (20 Schlüssel plus Namen passen nicht in die üblichen 200 Zeichen). */
export const CHANGE_AUDIT_TARGET_MAX = 700;

type Actor = Pick<Principal, "user" | "apiToken">;
const actorOf = (principal: Actor) => ({ id: principal.user.id, name: auditActorName(principal as Principal) });

/** Differenz zweier Listen: hinzugefügt und entzogen, jeweils sortiert. */
export function diffLists(before: Iterable<string>, after: Iterable<string>): { added: string[]; removed: string[] } {
  const was = new Set(before);
  const now = new Set(after);
  return { added: [...now].filter((x) => !was.has(x)).sort(), removed: [...was].filter((x) => !now.has(x)).sort() };
}

/** `Name: +a +b −c …und 3 weitere` (höchstens `limit` Einträge; zuerst Hinzugefügtes, dann Entzogenes). */
export function describeChange(label: string, added: readonly string[], removed: readonly string[], limit = CHANGE_AUDIT_LIMIT): string {
  const items = [...added.map((a) => `+${a}`), ...removed.map((r) => `−${r}`)];
  const shown = items.slice(0, limit);
  const rest = items.length - shown.length;
  return `${label}: ${shown.join(" ")}${rest > 0 ? ` …und ${rest} weitere` : ""}`;
}

/** Rechte einer Rolle geändert (`before`: bisherige Rechte, leer bei neuer Rolle). Schreibt nichts, wenn sich nichts geändert hat. */
export async function auditRolePermissionsChange(tx: Tx, principal: Actor, role: { id: string; name: string }, before: readonly string[], after: readonly string[]): Promise<void> {
  const { added, removed } = diffLists(before, after);
  if (added.length + removed.length === 0) return;
  await writeAudit(tx, "role.permissionsChanged", { actor: actorOf(principal), target: describeChange(role.name, added, removed), entityId: role.id, targetMax: CHANGE_AUDIT_TARGET_MAX });
}

/** Rollen eines Kontos geändert (`before`: bisherige Rollennamen, leer bei neuem Konto). Schreibt nichts, wenn sich nichts geändert hat. */
export async function auditUserRolesChange(tx: Tx, principal: Actor, user: { id: string; username: string }, before: readonly string[], after: readonly string[]): Promise<void> {
  const { added, removed } = diffLists(before, after);
  if (added.length + removed.length === 0) return;
  await writeAudit(tx, "user.rolesChanged", { actor: actorOf(principal), target: describeChange(user.username, added, removed), entityId: user.id, targetMax: CHANGE_AUDIT_TARGET_MAX });
}
