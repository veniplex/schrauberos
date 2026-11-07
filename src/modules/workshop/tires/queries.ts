import "server-only";
import { db } from "@/server/db";
import { getTireRules } from "./settings";
import { isWrongSeason, minTread, setHealth, wantedSeason, type Health, type TireHealth } from "@/modules/workshop/tires/domain";
import { customerDisplayName, customerNameSelect, unrestrictedCustomerWhere } from "@/modules/workshop/customers/public";
import type { Viewer } from "@/modules/types";

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

/**
 * Was das Etikett eines Reifensatzes braucht (F8): Kennzeichen, Größe, Saison, Marke/Modell, Lagerplatz, Einlagerungsdatum und der **Anzeigename** des Halters (Richtlinie D7: nur der Name, nie Telefon oder
 * Anschrift). Verlangt `tires.view`; Sätze von Fahrzeugen, deren Halter eingeschränkt verarbeitet wird (Art. 18 DSGVO), gibt es nicht (`null`). Explizites `select`: nichts darüber hinaus verlässt die Datenbank.
 */
export async function tireLabelData(viewer: Viewer, id: string) {
  if (!viewer.can("tires.view")) return null;
  const set = await db.tireSet.findFirst({
    where: { id, vehicle: { is: { OR: [{ customerId: null }, { customer: { is: unrestrictedCustomerWhere } }] } } },
    select: {
      id: true,
      season: true,
      brand: true,
      model: true,
      width: true,
      aspect: true,
      rim: true,
      loadIndex: true,
      speedIndex: true,
      status: true,
      storageLocation: true,
      storedAt: true,
      vehicle: { select: { plate: true, customer: { select: customerNameSelect } } },
    },
  });
  if (!set) return null;
  const { vehicle, ...rest } = set;
  return { ...rest, plate: vehicle.plate, ownerName: vehicle.customer ? customerDisplayName(vehicle.customer) : null };
}

export type TireLabelData = NonNullable<Awaited<ReturnType<typeof tireLabelData>>>;
