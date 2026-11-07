import { addDays } from "date-fns";
import type { PrismaClient } from "@/generated/prisma/client";
import { atDay, noonOf } from "@/lib/seed-days";
import type { SeedDef } from "@/modules/types";

/** Beispiel-Fuhrpark mit Kilometerständen, Kosten und Führerscheinkontrollen; Fahrer sind die Demo-Mitarbeiter (gefunden über den Nachnamen). */
async function demo(db: PrismaClient) {
  if ((await db.fleetVehicle.count()) > 0) return;
  console.log("Demo-Daten (Fuhrpark) werden angelegt …");

  const employee = async (lastName: string) => (await db.employee.findFirst({ where: { lastName }, select: { id: true } }))?.id ?? null;
  const tomId = await employee("Meyer");
  const lenaId = await employee("Hoffmann");
  const juliaId = await employee("Wagner");

  const caddy = await db.fleetVehicle.create({
    data: { plate: "B-FW 101", make: "VW", model: "Caddy Cargo", year: 2022, fuelType: "diesel", driverId: tomId, location: "Werkstatthof", huDue: atDay(25), serviceDueKm: 60000,
      insuranceCompany: "Sicher Versicherung AG", insurancePolicy: "KFZ-2201-884", insuranceUntil: atDay(280), leasingProvider: "AutoLease Bank", leasingUntil: atDay(300), leasingRateCents: 28900, fuelCardNo: "7001 2200 4411" },
  });
  const transit = await db.fleetVehicle.create({
    data: { plate: "B-FW 102", make: "Ford", model: "Transit Custom", year: 2021, fuelType: "diesel", driverId: lenaId, location: "Werkstatthof", huDue: atDay(210), serviceDue: atDay(18),
      insuranceCompany: "Sicher Versicherung AG", insurancePolicy: "KFZ-2102-117", insuranceUntil: atDay(280), leasingProvider: "AutoLease Bank", leasingUntil: atDay(40), leasingRateCents: 34900 },
  });
  const octavia = await db.fleetVehicle.create({
    data: { plate: "B-FW 103", make: "Škoda", model: "Octavia Combi", year: 2020, fuelType: "petrol", driverId: juliaId, location: "Büro", huDue: atDay(120), serviceDueKm: 45000,
      insuranceCompany: "Sicher Versicherung AG", insurancePolicy: "KFZ-2003-559", insuranceUntil: atDay(190) },
  });
  const km = (fleetVehicleId: string, daysAgo: number, value: number) =>
    db.fleetMileage.create({ data: { fleetVehicleId, date: noonOf(atDay(-daysAgo)), km: value } });
  await km(caddy.id, 180, 21000); await km(caddy.id, 90, 26500); await km(caddy.id, 5, 31800);
  await km(transit.id, 150, 62000); await km(transit.id, 60, 70400); await km(transit.id, 3, 74900);
  await km(octavia.id, 200, 40100); await km(octavia.id, 100, 42500); await km(octavia.id, 7, 44200);
  const cost = (fleetVehicleId: string, daysAgo: number, category: string, amountCents: number, note?: string) =>
    db.fleetCost.create({ data: { fleetVehicleId, date: noonOf(atDay(-daysAgo)), category, amountCents, note: note ?? null } });
  await cost(caddy.id, 12, "fuel", 7450); await cost(caddy.id, 40, "fuel", 6890); await cost(caddy.id, 95, "service", 31200, "Inspektion + Ölwechsel");
  await cost(transit.id, 8, "fuel", 9120); await cost(transit.id, 70, "repair", 48750, "Bremsscheiben vorn");
  await cost(octavia.id, 15, "fuel", 6240); await cost(octavia.id, 120, "tires", 52000, "Winterreifen");

  // Führerscheinkontrollen: Tom bald fällig, Lena abgelaufen, Julia nie kontrolliert
  const check = (employeeId: string | null, monthsAgo: number) => {
    if (!employeeId) return null;
    const checkedAt = noonOf(addDays(atDay(0), -monthsAgo * 30));
    return db.fleetLicenseCheck.create({ data: { employeeId, checkedAt, nextDue: noonOf(addDays(checkedAt, 182)), method: "Sichtkontrolle", checkedByName: "Administrator" } });
  };
  await check(tomId, 5);
  await check(lenaId, 8);
}

export const seeds: SeedDef[] = [{ id: "fleet", feature: "office.fleet", order: 110, demo }];
