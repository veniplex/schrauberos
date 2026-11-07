import "server-only";
import { cache } from "react";
import { db } from "@/server/db";

/** Regeln der Mitarbeiterverwaltung (Singleton-Zeile, wird beim ersten Zugriff mit Standardwerten angelegt): Stichtag, an dem der Resturlaub des Vorjahres verfällt (Standard 31.03.). */
export type EmployeeRules = { vacationCarryMonth: number; vacationCarryDay: number };

export const getEmployeeRules = cache(async (): Promise<EmployeeRules> => {
  const row = await db.employeeSettings.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
  return { vacationCarryMonth: row.vacationCarryMonth, vacationCarryDay: row.vacationCarryDay };
});
