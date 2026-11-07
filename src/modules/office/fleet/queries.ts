import "server-only";
import { endOfDayIn, startOfDayIn } from "@/lib/dates";
import { dayKey } from "@/lib/zone";
import { db } from "@/server/db";
import { currentMileage, fleetDues } from "@/modules/office/fleet/domain";

/**
 * Der Fahrer eines Firmenfahrzeugs ist ein Mitarbeiter (`office.employees`); die Fuhrparkseiten brauchen nur Namen und Id. Immer mit `select` lesen – ein `include: { driver: true }`
 * holte den ganzen Mitarbeiter samt besonders geschützten Daten (Notfallkontakt) aus der Datenbank.
 */
const DRIVER_NAME = { select: { id: true, firstName: true, lastName: true } } as const;

/** Firmenfahrzeuge inkl. Fahrer (nur Name), aktuellem Kilometerstand und anstehenden Fälligkeiten. */
export async function listFleet(where: object = {}) {
  const vehicles = await db.fleetVehicle.findMany({
    where,
    include: { driver: DRIVER_NAME, mileage: { select: { km: true } } },
    orderBy: { plate: "asc" },
  });
  return vehicles.map((v) => {
    const km = currentMileage(v.mileage);
    return { ...v, currentKm: km, dues: fleetDues(v, km) };
  });
}

export type FleetRow = Awaited<ReturnType<typeof listFleet>>[number];

/** Ein Firmenfahrzeug für die Detailseite: Fahrer (Name, letzte Führerscheinkontrolle), die neuesten Kilometerstände und Kosten. */
export async function getFleetVehicleDetail(id: string) {
  return db.fleetVehicle.findUnique({
    where: { id },
    include: {
      driver: { select: { id: true, firstName: true, lastName: true, licenseChecks: { orderBy: { checkedAt: "desc" }, take: 1 } } },
      mileage: { orderBy: [{ date: "desc" }, { km: "desc" }], take: 30 },
      costs: { orderBy: { date: "desc" }, take: 50 },
    },
  });
}

/** Fahrer = aktive Mitarbeiter, denen ein nicht verkauftes Firmenfahrzeug zugeordnet ist, mit ihren Fahrzeugen und den letzten Führerscheinkontrollen (nur Namen, keine Mitarbeiterdaten darüber hinaus). */
export async function listDrivers(checks: number) {
  return db.employee.findMany({
    where: { active: true, fleetVehicles: { some: { status: { not: "sold" } } } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      fleetVehicles: { where: { status: { not: "sold" } }, select: { id: true, plate: true } },
      licenseChecks: { orderBy: { checkedAt: "desc" }, take: checks },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}

/** Ein Firmenfahrzeug nur zum Titel. */
export async function fleetPlate(id: string): Promise<string | null> {
  return (await db.fleetVehicle.findUnique({ where: { id }, select: { plate: true } }))?.plate ?? null;
}

export type FleetDeadline = { id: string; kind: "hu" | "service"; plate: string; /** Kalendertag der Frist (`JJJJ-MM-TT`) */ day: string };

/**
 * Fristen der Firmenfahrzeuge für den Kalender-Abo (F10): Hauptuntersuchung (`huDue`) und Service (`serviceDue`) im Zeitraum `from`…`to` (Kalendertage, einschließlich), ohne verkaufte Fahrzeuge.
 * Verlangt `fleet.view`; nur Kennzeichen und Tag (kein Fahrer, keine Versicherung, kein Leasing).
 */
export async function fleetDeadlines(viewer: { can: (permission: "fleet.view") => boolean }, from: string, to: string, take = 2000): Promise<FleetDeadline[]> {
  if (!viewer.can("fleet.view")) return [];
  const range = { gte: startOfDayIn(from), lte: endOfDayIn(to) };
  const rows = await db.fleetVehicle.findMany({
    where: { status: { not: "sold" }, OR: [{ huDue: range }, { serviceDue: range }] },
    orderBy: [{ plate: "asc" }, { id: "asc" }],
    take,
    select: { id: true, plate: true, huDue: true, serviceDue: true },
  });
  const out: FleetDeadline[] = [];
  for (const v of rows) {
    for (const [kind, due] of [["hu", v.huDue], ["service", v.serviceDue]] as const) {
      if (!due) continue;
      const day = dayKey(due);
      if (day >= from && day <= to) out.push({ id: v.id, kind, plate: v.plate, day });
    }
  }
  return out;
}
