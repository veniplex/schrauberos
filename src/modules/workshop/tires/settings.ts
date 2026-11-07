import "server-only";
import { cache } from "react";
import { db } from "@/server/db";
import type { TireRules } from "./domain";

/** Grenzwerte für die Reifen-Ampel und das Winterfenster (Singleton-Zeile, wird beim ersten Zugriff mit Standardwerten angelegt). */
export const getTireRules = cache(async (): Promise<TireRules> => {
  const row = await db.tireSettings.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
  return {
    treadWarnMm: row.treadWarnMm,
    treadReplaceMm: row.treadReplaceMm,
    tireAgeWarnYears: row.tireAgeWarnYears,
    tireAgeReplaceYears: row.tireAgeReplaceYears,
    winterStartMonth: row.winterStartMonth,
    winterEndMonth: row.winterEndMonth,
  };
});
