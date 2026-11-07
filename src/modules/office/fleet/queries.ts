import "server-only";
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
