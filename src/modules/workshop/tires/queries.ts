import "server-only";
import { db } from "@/server/db";
import { getTireRules } from "./settings";
import { isWrongSeason, minTread, setHealth, wantedSeason, type Health, type TireHealth } from "@/modules/workshop/tires/domain";
import { customerNameSelect } from "@/modules/workshop/customers/public";

const OPEN_APPOINTMENT = { notIn: ["cancelled", "done", "no_show"] };

export type TireSetRow = Awaited<ReturnType<typeof loadSets>>[number] & {
  health: TireHealth;
  minTreadMm: number | null;
  /** Lagert und die aktuell passende Saison – Wechsel steht an */
  swapDue: boolean;
  /** Montiert (beim Kunden), aber zur Jahreszeit passt der andere Satz – Hinweis in Liste und Übersicht */
  wrongSeason: boolean;
  nextAppointment: { id: string; startsAt: Date } | null;
};

function loadSets(where: object = {}) {
  return db.tireSet.findMany({
    where,
    include: {
      tires: true,
      vehicle: { include: { customer: { select: customerNameSelect } } },
      appointments: {
        where: { startsAt: { gte: new Date() }, status: OPEN_APPOINTMENT },
        orderBy: { startsAt: "asc" },
        take: 1,
        select: { id: true, startsAt: true },
      },
    },
  });
}

/** Reifensätze inkl. berechnetem Zustand (Profil/Alter/Zustand) und Wechsel-Hinweis. */
export async function listTireSets(where: object = {}): Promise<TireSetRow[]> {
  const [sets, rules] = await Promise.all([loadSets(where), getTireRules()]);
  const now = new Date();
  const season = wantedSeason(now, rules);
  return sets.map((s) => {
    const nextAppointment = s.appointments[0] ?? null;
    return {
      ...s,
      health: setHealth(s.tires, rules, now),
      minTreadMm: minTread(s.tires),
      swapDue: s.status === "stored" && s.season === season && !nextAppointment,
      wrongSeason: isWrongSeason(s, season),
      nextAppointment,
    };
  });
}

const SEVERITY: Record<Health, number> = { replace: 3, warn: 2, unknown: 1, ok: 0 };

export function bySeverity(a: TireSetRow, b: TireSetRow): number {
  return SEVERITY[b.health.health] - SEVERITY[a.health.health] || (a.minTreadMm ?? 99) - (b.minTreadMm ?? 99);
}
