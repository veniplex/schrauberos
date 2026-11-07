import "server-only";
import { cache } from "react";
import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import { createHolidayCalendar, isHolidayRegion, RULE_MODES, type CustomHoliday, type HolidayConfig, type RuleMode } from "@/lib/holidays";
import { db } from "@/server/db";

/**
 * Feiertage der Werkstatt (Plattform, P4b-0): liest Region, Änderungen an den gesetzlichen Tagen und eigene Tage aus der Datenbank und macht daraus den `HolidayCalendar`
 * (`src/lib/holidays.ts`). Funktionen (Termine, Mitarbeiter …) lesen **nur hierüber**; Pflege: Verwaltung → Einstellungen → Feiertage.
 */
type Reader = Pick<PrismaClient | Prisma.TransactionClient, "holidaySettings" | "holidayDay">;

export async function readHolidayConfig(client: Reader = db): Promise<HolidayConfig> {
  const [settings, days] = await Promise.all([client.holidaySettings.findUnique({ where: { id: "default" } }), client.holidayDay.findMany({ orderBy: [{ month: "asc" }, { day: "asc" }] })]);
  const region = settings && isHolidayRegion(settings.region) ? settings.region : "";
  const rules: Record<string, RuleMode> = {};
  const custom: CustomHoliday[] = [];
  for (const d of days) {
    if (d.kind === "rule" && d.ruleKey && d.mode && (RULE_MODES as readonly string[]).includes(d.mode)) rules[d.ruleKey] = d.mode as RuleMode;
    else if (d.kind === "custom" && d.name && d.month && d.day) custom.push({ id: d.id, name: d.name, month: d.month, day: d.day, year: d.year, half: d.half });
  }
  return { region, rules, custom };
}

/** Der Feiertagskalender der Werkstatt (je Anfrage einmal gelesen). */
export const getHolidays = cache(async () => createHolidayCalendar(await readHolidayConfig()));
