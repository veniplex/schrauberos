import "server-only";
import { db } from "@/server/db";
import { currentMileage, fleetDues } from "@/lib/domain/fleet";

/** Firmenfahrzeuge inkl. Fahrer, aktuellem Kilometerstand und anstehenden Fälligkeiten. */
export async function listFleet(where: object = {}) {
  const vehicles = await db.fleetVehicle.findMany({
    where,
    include: { driver: true, mileage: { select: { km: true } } },
    orderBy: { plate: "asc" },
  });
  return vehicles.map((v) => {
    const km = currentMileage(v.mileage);
    return { ...v, currentKm: km, dues: fleetDues(v, km) };
  });
}

export type FleetRow = Awaited<ReturnType<typeof listFleet>>[number];
