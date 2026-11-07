import "server-only";
import type { SetupCheckDef } from "@/modules/types";
import { db } from "@/server/db";

/**
 * Einrichtungsschritte der Benutzerverwaltung: der **Wiederherstellungs-Code** (Notzugang) der angemeldeten Administration ist als gesichert bestätigt (sonst im Konto sichern oder
 * neu erzeugen – das zeigt auch das Banner oben) und es gibt weitere Konten als das erste.
 */
export const setupChecks: SetupCheckDef[] = [
  {
    id: "recoveryCode",
    feature: "admin.users",
    permission: "users.manage",
    labelKey: "users.checklist.recoveryCode.label",
    hintKey: "users.checklist.recoveryCode.hint",
    href: "/account",
    order: 20,
    done: async ({ session }) => {
      const code = await db.recoveryCode.findUnique({ where: { userId: session.user.id }, select: { confirmedAt: true } });
      return code !== null && code.confirmedAt !== null;
    },
  },
  { id: "moreUsers", feature: "admin.users", permission: "users.manage", labelKey: "users.checklist.moreUsers.label", hintKey: "users.checklist.moreUsers.hint", href: "/admin/users/new", order: 40, done: async () => (await db.user.count({ where: { active: true } })) > 1 },
];
