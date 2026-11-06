import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { actorOf, type Actor, type RoleRights } from "@/lib/rbac";

/** Datenbank-Hilfen zur Rechte-Hierarchie (Logik: `src/lib/rbac.ts`). Läuft mit `db` oder dem Client einer Transaktion. */
type Client = Pick<Prisma.TransactionClient, "user" | "role">;

const ROLE_WITH_PERMISSIONS = { include: { permissions: true } } as const;

/** Die Rollen des Aufrufers frisch aus der Datenbank – innerhalb der Transaktion, in der auch geschrieben wird. */
export async function loadActor(tx: Client, userId: string): Promise<Actor> {
  const user = await tx.user.findUnique({ where: { id: userId }, include: { roles: { include: { role: ROLE_WITH_PERMISSIONS } } } });
  return actorOf(userId, (user?.roles ?? []).map((r) => toRights(r.role)));
}

export const toRights = (role: { id: string; isAdmin: boolean; permissions: { permission: string }[] }): RoleRights & { id: string } => ({
  id: role.id,
  isAdmin: role.isAdmin,
  permissions: role.permissions.map((p) => p.permission),
});

export async function loadRoles(tx: Client, ids: readonly string[]) {
  const roles = await tx.role.findMany({ where: { id: { in: [...ids] } }, ...ROLE_WITH_PERMISSIONS });
  return roles.map(toRights);
}
