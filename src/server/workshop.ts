import "server-only";
import { cache } from "react";
import { db } from "@/server/db";
import { parseOpeningHours } from "@/lib/opening-hours";

/**
 * Werkstatt-Profil (Singleton, Plattform): Name, Adresse, Branding, Öffnungszeiten.
 * Funktionsspezifische Einstellungen (Kalender, Reifenregeln …) liegen bei der jeweiligen Funktion.
 */
export const getWorkshop = cache(async () => {
  // upsert statt find+create: robust, falls zwei erste Anfragen gleichzeitig eintreffen
  const row =
    (await db.workshop.findUnique({ where: { id: "default" } })) ??
    (await db.workshop.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } }));
  return { ...row, hours: parseOpeningHours(row.openingHours) };
});

export type Workshop = Awaited<ReturnType<typeof getWorkshop>>;
