import type { PrismaClient } from "@/generated/prisma/client";
import { DEFAULT_ROLES } from "@/modules/default-roles";

/**
 * Basisdaten einer frischen Installation: Werkstatt-Profil, Einstellungs-Zeilen, Standardrollen, Arbeitsplätze und Terminarten.
 * Läuft bei jedem App-Start, legt aber nur bei einer leeren Datenbank etwas an – spätere Änderungen und bewusst gelöschte
 * Standardwerte bleiben unangetastet. Nur die Administrator-Rolle wird immer sichergestellt.
 */
export async function ensureBaseData(db: PrismaClient): Promise<{ fresh: boolean }> {
  const fresh = (await db.workshop.count()) === 0;

  if (fresh) {
    await db.workshop.create({ data: { id: "default" } });
    await db.appointmentSettings.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
    await db.tireSettings.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
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
    await db.bay.createMany({
      data: [
        { name: "Hebebühne 1", sortOrder: 1 },
        { name: "Hebebühne 2", sortOrder: 2 },
        { name: "Reifenplatz", sortOrder: 3 },
      ],
    });
    await db.appointmentType.createMany({
      data: [
        { name: "Inspektion", color: "#2459c9", defaultMinutes: 90, sortOrder: 1 },
        { name: "Ölwechsel", color: "#b45309", defaultMinutes: 45, sortOrder: 2 },
        { name: "Reifenwechsel", color: "#0f766e", defaultMinutes: 45, sortOrder: 3, kind: "tire_change" },
        { name: "HU/AU", color: "#7e22ce", defaultMinutes: 60, sortOrder: 4 },
        { name: "Reparatur", color: "#b91c1c", defaultMinutes: 120, sortOrder: 5 },
        { name: "Diagnose", color: "#475569", defaultMinutes: 30, sortOrder: 6 },
      ],
    });
  }

  // Ohne Administrator-Rolle ließe sich niemand mehr einrichten oder aussperren-retten
  const adminRole = DEFAULT_ROLES.find((r) => r.key === "admin")!;
  if (!(await db.role.findUnique({ where: { key: "admin" } }))) {
    await db.role.create({ data: { key: "admin", name: adminRole.name, description: adminRole.description, isAdmin: true, isSystem: true } });
  }
  return { fresh };
}
