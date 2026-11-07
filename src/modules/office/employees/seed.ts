import type { PrismaClient } from "@/generated/prisma/client";
import { atDay, noonOf } from "@/lib/seed-days";
import type { SeedDef } from "@/modules/types";

/** Beispiel-Mitarbeiter mit Qualifikationen und Abwesenheiten (einige bald oder bereits abgelaufen/laufend). */
async function demo(db: PrismaClient) {
  if ((await db.employee.count()) > 0) return;
  console.log("Demo-Daten (Mitarbeiter) werden angelegt …");

  const mk = (firstName: string, lastName: string, department: string, jobTitle: string, extra: Record<string, unknown> = {}) =>
    db.employee.create({
      data: {
        firstName, lastName, department, jobTitle, vacationDaysPerYear: 30, active: true,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`, hireDate: new Date("2019-04-01"),
        ...extra,
      },
    });
  const chef = await mk("Thomas", "Brandt", "management", "Geschäftsführer", { personnelNumber: "1001", emergencyName: "Karin Brandt", emergencyPhone: "0170 5550101", emergencyRelation: "Ehefrau" });
  const julia = await mk("Julia", "Wagner", "office", "Assistenz der Geschäftsführung", { personnelNumber: "1002" });
  // Teilzeit: Montag bis Donnerstag, 24 Urlaubstage (Arbeitstage dieser Person)
  const petra = await mk("Petra", "Lehmann", "office", "Buchhaltung", { personnelNumber: "1003", workWeekdays: "1,2,3,4", vacationDaysPerYear: 24 });
  await mk("Ida", "Kaiser", "it", "Systemadministratorin", { personnelNumber: "1004", emergencyName: "Jonas Kaiser", emergencyPhone: "0171 5550102", emergencyRelation: "Bruder" });
  const tom = await mk("Tom", "Meyer", "workshop", "Kfz-Mechatroniker", { personnelNumber: "2001" });
  const sven = await mk("Sven", "Richter", "workshop", "Kfz-Mechatroniker", { personnelNumber: "2002" });
  const lena = await mk("Lena", "Hoffmann", "workshop", "Kfz-Meisterin / Werkstattleitung", { personnelNumber: "2003", emergencyName: "Paul Hoffmann", emergencyPhone: "0172 5550103", emergencyRelation: "Ehemann" });
  const murat = await mk("Murat", "Demir", "workshop", "Lager & Reifenservice", { personnelNumber: "2004" });
  await mk("Frank", "Neumann", "workshop", "Kfz-Mechatroniker (ausgeschieden)", { personnelNumber: "2000", active: false, leaveDate: new Date("2025-12-31") });

  // Qualifikationen (einige bald/bereits abgelaufen)
  const qual = (employeeId: string, name: string, expiresInDays: number | null) =>
    db.qualification.create({ data: { employeeId, name, issuedAt: new Date("2022-03-01"), expiresAt: expiresInDays == null ? null : atDay(expiresInDays) } });
  await qual(lena.id, "Hochvolt-Fachkundiger (HV 2S)", 25);
  await qual(lena.id, "Klimaservice (Kältemittel)", 400);
  await qual(tom.id, "Hochvolt-Schulung HV 1S", -12);
  await qual(sven.id, "Brandschutzhelfer", 700);
  await qual(murat.id, "Staplerschein", 45);
  await qual(julia.id, "Ersthelfer", 120);

  // Abwesenheiten
  const absence = (employeeId: string, type: string, from: number, to: number, note?: string) =>
    db.absence.create({ data: { employeeId, type, startDate: noonOf(atDay(from)), endDate: noonOf(atDay(to)), note: note ?? null } });
  await absence(julia.id, "vacation", -1, 3, "Sommerurlaub");
  await absence(sven.id, "sick", 0, 1);
  await absence(petra.id, "training", 6, 7, "DATEV-Seminar");
  await absence(tom.id, "vacation", 14, 25);
  await absence(chef.id, "vacation", 30, 38);
}

export const seeds: SeedDef[] = [{ id: "employees", feature: "office.employees", order: 100, demo }];
