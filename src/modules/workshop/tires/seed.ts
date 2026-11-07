import { addDays } from "@/lib/zone";
import type { PrismaClient } from "@/generated/prisma/client";
import { normalizePlate } from "@/lib/plate";
import type { SeedDef } from "@/modules/types";

/** Basisdaten: die Einstellungszeile der Reifenlagerung (Saisonfenster u. a.). */
async function base(db: PrismaClient) {
  await db.tireSettings.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
}

const dot = (week: number, year: number) => ({
  dot: `${String(week).padStart(2, "0")}${String(year % 100).padStart(2, "0")}`,
  producedWeek: week,
  producedYear: year,
});

/** Reifensätze der Demo-Fahrzeuge (gefunden über das Kennzeichen); Fahrzeuge, die es nicht gibt, werden übersprungen. */
async function demo(db: PrismaClient) {
  if ((await db.tireSet.count()) > 0) return;
  console.log("Demo-Daten (Reifensätze) werden angelegt …");

  // Reifensätze – bewusst mit unterschiedlichem Zustand, damit Warnungen sichtbar werden
  const sets: Array<{
    plate: string; season: string; brand: string; model: string; w: number; a: number; r: number; rim: string; loc: string; status?: string;
    tires: Array<{ pos: string; week: number; year: number; tread: number; cond: string }>;
  }> = [
    { plate: "B-AB 1234", season: "winter", brand: "Continental", model: "WinterContact TS 870", w: 205, a: 55, r: 16, rim: "alloy", loc: "Halle A / Regal 1 / Fach 3",
      tires: ["FL", "FR", "RL", "RR"].map((pos) => ({ pos, week: 38, year: 2022, tread: 6.5, cond: "good" })) },
    { plate: "B-MS 4711", season: "summer", brand: "Michelin", model: "Primacy 4", w: 225, a: 45, r: 17, rim: "alloy", loc: "Halle A / Regal 2 / Fach 1",
      tires: [
        { pos: "FL", week: 12, year: 2019, tread: 3.2, cond: "fair" }, { pos: "FR", week: 12, year: 2019, tread: 3.0, cond: "fair" },
        { pos: "RL", week: 12, year: 2019, tread: 3.8, cond: "good" }, { pos: "RR", week: 12, year: 2019, tread: 3.6, cond: "good" },
      ] },
    { plate: "B-MS 815", season: "winter", brand: "Goodyear", model: "UltraGrip 9+", w: 195, a: 55, r: 16, rim: "steel", loc: "Halle A / Regal 2 / Fach 4",
      tires: ["FL", "FR", "RL", "RR"].map((pos) => ({ pos, week: 41, year: 2016, tread: 2.6, cond: "worn" })) },
    { plate: "B-EY 2020", season: "winter", brand: "Bridgestone", model: "Blizzak LM005", w: 205, a: 60, r: 16, rim: "none", loc: "Halle B / Regal 5 / Fach 2",
      tires: ["FL", "FR", "RL", "RR"].map((pos) => ({ pos, week: 44, year: 2023, tread: 7.4, cond: "new" })) },
    // Sommersatz, der gerade am Fahrzeug montiert ist (ausgelagert): im Winter zeigt er den Hinweis „Falsche Saison“, nach dem Wechsel liegt er wieder im Lager
    { plate: "B-AB 1234", season: "summer", brand: "Pirelli", model: "Cinturato P7", w: 205, a: 55, r: 16, rim: "steel", loc: "beim Kunden montiert", status: "mounted",
      tires: ["FL", "FR", "RL", "RR"].map((pos) => ({ pos, week: 18, year: 2022, tread: 5.2, cond: "good" })) },
    { plate: "B-AN 100", season: "allseason", brand: "Vredestein", model: "Quatrac Pro", w: 235, a: 65, r: 16, rim: "steel", loc: "Halle B / Regal 1 / Fach 1",
      tires: ["FL", "FR", "RL", "RR"].map((pos) => ({ pos, week: 8, year: 2020, tread: 4.4, cond: "good" })) },
    { plate: "HVL-JK 77", season: "summer", brand: "Hankook", model: "Ventus Prime 3", w: 205, a: 55, r: 16, rim: "alloy", loc: "Halle A / Regal 3 / Fach 2",
      tires: ["FL", "FR", "RL", "RR"].map((pos) => ({ pos, week: 20, year: 2024, tread: 7.0, cond: "good" })) },
    { plate: "B-SN 909", season: "winter", brand: "Pirelli", model: "Cinturato Winter", w: 225, a: 45, r: 17, rim: "alloy", loc: "Halle B / Regal 3 / Fach 4",
      tires: [
        { pos: "FL", week: 33, year: 2017, tread: 4.6, cond: "good" }, { pos: "FR", week: 33, year: 2017, tread: 4.4, cond: "good" },
        { pos: "RL", week: 33, year: 2017, tread: 5.2, cond: "good" }, { pos: "RR", week: 33, year: 2017, tread: 5.0, cond: "good" },
      ] },
  ];

  for (const s of sets) {
    const vehicle = await db.vehicle.findFirst({ where: { plateNorm: normalizePlate(s.plate) }, select: { id: true } });
    if (!vehicle) continue;
    await db.tireSet.create({
      data: {
        vehicleId: vehicle.id,
        season: s.season, brand: s.brand, model: s.model, width: s.w, aspect: s.a, rim: s.r, rimType: s.rim,
        storageLocation: s.loc, status: s.status ?? "stored", storedAt: addDays(new Date(), -120),
        tires: {
          create: s.tires.map((t) => ({
            position: t.pos, ...dot(t.week, t.year), treadDepthMm: t.tread, condition: t.cond, measuredAt: addDays(new Date(), -120),
          })),
        },
      },
    });
  }
}

export const seeds: SeedDef[] = [{ id: "tires", feature: "workshop.tires", order: 50, base, demo }];
