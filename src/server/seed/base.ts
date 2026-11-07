import type { PrismaClient } from "@/generated/prisma/client";
import { DEFAULT_ROLES } from "@/modules/default-roles";
import { ALL_SEEDS } from "@/modules/seed";

/**
 * Basisdaten einer frischen Installation: Werkstatt-Profil, Standardrollen und die Grunddaten der Funktionen (`base` ihrer `seed.ts`: Einstellungszeilen, Arbeitsplätze,
 * Terminarten …). Läuft bei jedem App-Start, legt aber nur bei einer leeren Datenbank etwas an – spätere Änderungen und bewusst gelöschte
 * Standardwerte bleiben unangetastet. Nur die Administrator-Rolle wird immer sichergestellt.
 */
export async function ensureBaseData(db: PrismaClient): Promise<{ fresh: boolean }> {
  const fresh = (await db.workshop.count()) === 0;

  if (fresh) {
    await db.workshop.create({ data: { id: "default" } });
    for (const role of DEFAULT_ROLES) {
      if (await db.role.findUnique({ where: { key: role.key } })) continue;
      await db.role.create({
        data: {
          key: role.key,
          name: role.name,
          description: role.description,
          isAdmin: role.isAdmin ?? false,
          isSystem: role.key === "admin",
          permissions: { create: role.permissions.map((permission) => ({ permission })) },
        },
      });
    }
    for (const seed of ALL_SEEDS) await seed.base?.(db);
  }

  // Ohne Administrator-Rolle ließe sich niemand mehr einrichten oder aussperren-retten
  const adminRole = DEFAULT_ROLES.find((r) => r.key === "admin")!;
  if (!(await db.role.findUnique({ where: { key: "admin" } }))) {
    await db.role.create({ data: { key: "admin", name: adminRole.name, description: adminRole.description, isAdmin: true, isSystem: true } });
  }
  return { fresh };
}
