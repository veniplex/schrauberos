import "server-only";
import { cache } from "react";
import { db } from "@/server/db";
import { DEFAULT_DAILY_TARGET_MINUTES } from "./constants";

/** Regeln der Zeiterfassung (Singleton-Zeile): Sollzeit je Arbeitstag. Fehlt die Zeile, gilt der Standard (8 Stunden), ohne dass beim Lesen geschrieben wird. */
export type TimeRules = { dailyTargetMinutes: number };

export const getTimeRules = cache(async (): Promise<TimeRules> => {
  const row = await db.timeSettings.findUnique({ where: { id: "default" }, select: { dailyTargetMinutes: true } });
  return { dailyTargetMinutes: row?.dailyTargetMinutes ?? DEFAULT_DAILY_TARGET_MINUTES };
});
