import "server-only";
import { cache } from "react";
import { db } from "@/server/db";
import { parseOpeningHours } from "@/lib/domain/opening-hours";
import type { TireRules } from "@/lib/domain/tires";

/** Werkstatt-Profil (Singleton). Wird beim ersten Zugriff mit Standardwerten angelegt. */
export const getWorkshop = cache(async () => {
  // upsert statt find+create: robust, falls zwei erste Anfragen gleichzeitig eintreffen
  const row =
    (await db.workshop.findUnique({ where: { id: "default" } })) ??
    (await db.workshop.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } }));
  const tireRules: TireRules = {
    treadWarnMm: row.treadWarnMm,
    treadReplaceMm: row.treadReplaceMm,
    tireAgeWarnYears: row.tireAgeWarnYears,
    tireAgeReplaceYears: row.tireAgeReplaceYears,
  };
  return { ...row, hours: parseOpeningHours(row.openingHours), tireRules };
});

export type Workshop = Awaited<ReturnType<typeof getWorkshop>>;
