import "server-only";
import { dayKey } from "@/lib/zone";
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

export type StorageRow = { location: string | null; summer: number; winter: number; allseason: number; total: number; /** Einlagerung des ältesten Satzes (Kalendertag der Werkstatt-Zone) */ oldestDay: string };
export type StorageOverview = { total: number; bySeason: { summer: number; winter: number; allseason: number }; rows: StorageRow[]; /** Lagerplätze über der Anzeigegrenze (die Summen zählen alle) */ moreLocations: number };

/** So viele Lagerplätze zeigt der Bericht höchstens. */
export const STORAGE_LOCATION_LIMIT = 200;

/**
 * **Einlagerungsbestand** für den Bericht (F9): die eingelagerten Reifensätze (Status „eingelagert“) nach Lagerplatz und Saison, von der Datenbank gezählt (`groupBy`). Es stehen **keine Namen und keine
 * Kennzeichen** darin – nur Anzahlen je Lagerplatz (auch Sätze von Kunden mit eingeschränkter Verarbeitung zählen mit: eine Zahl ist keine personenbezogene Angabe). Verlangt `tires.view`.
 */
export async function storageOverview(viewer: Viewer): Promise<StorageOverview | null> {
  if (!viewer.can("tires.view")) return null;
  const groups = await db.tireSet.groupBy({ by: ["storageLocation", "season"], where: { status: "stored" }, _count: { _all: true }, _min: { storedAt: true } });
  const bySeason = { summer: 0, winter: 0, allseason: 0 };
  const byLocation = new Map<string, StorageRow>();
  for (const g of groups) {
    const key = g.storageLocation?.trim() ? g.storageLocation.trim() : "";
    const row = byLocation.get(key) ?? { location: key === "" ? null : key, summer: 0, winter: 0, allseason: 0, total: 0, oldestDay: "9999-12-31" };
    const season = g.season === "summer" || g.season === "winter" ? g.season : "allseason";
    row[season] += g._count._all;
    row.total += g._count._all;
    bySeason[season] += g._count._all;
    const day = g._min.storedAt ? dayKey(g._min.storedAt) : row.oldestDay;
    if (day < row.oldestDay) row.oldestDay = day;
    byLocation.set(key, row);
  }
  const all = [...byLocation.values()].sort((a, b) => (a.location === null ? 1 : b.location === null ? -1 : a.location.localeCompare(b.location, "de", { numeric: true })));
  return { total: bySeason.summer + bySeason.winter + bySeason.allseason, bySeason, rows: all.slice(0, STORAGE_LOCATION_LIMIT), moreLocations: Math.max(0, all.length - STORAGE_LOCATION_LIMIT) };
}
