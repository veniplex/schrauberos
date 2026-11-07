import "server-only";
import { cache } from "react";
import { db } from "@/server/db";
import { parseOpeningHours } from "@/lib/opening-hours";
import { setWorkshopZone } from "@/lib/zone";

/**
 * Werkstatt-Profil (Singleton, Plattform): Name, Adresse, Branding, Öffnungszeiten.
 * Funktionsspezifische Einstellungen (Kalender, Reifenregeln …) liegen bei der jeweiligen Funktion.
 */
export const getWorkshop = cache(async () => {
  // upsert statt find+create: robust, falls zwei erste Anfragen gleichzeitig eintreffen
  const row =
    (await db.workshop.findUnique({ where: { id: "default" } })) ??
    (await db.workshop.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } }));
  // Die Werkstatt-Zone gehört der Einstellung: wer das Profil liest, hat sie (auch in einem Prozess, in dem Start und Einrichtung nicht gelaufen sind)
  setWorkshopZone(row.timezone);
  return { ...row, hours: parseOpeningHours(row.openingHours) };
});

export type Workshop = Awaited<ReturnType<typeof getWorkshop>>;
