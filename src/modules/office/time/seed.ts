import type { PrismaClient } from "@/generated/prisma/client";
import type { SeedDef } from "@/modules/types";
import { addDaysToKey, parseZoned, weekdayOfKey } from "@/lib/zone";
import { todayInput } from "@/lib/dates";

/**
 * Demo-Zeiten der Werkstatt-Mitarbeiter (gefunden über den Nachnamen; fehlt einer, entfallen seine Zeiten): Tagesschichten mit Pause an den letzten Werktagen, teils auf Aufträge (gefunden über den
 * Status), dazu ein nachgetragener, ein korrigierter und ein stornierter Eintrag mit Verlauf und ein laufender Eintrag. Die Mitarbeiter der Demo haben kein Konto: Das Stempeln selbst probiert man mit
 * einem Konto, dem ein Mitarbeiter zugeordnet ist.
 */
async function demo(db: PrismaClient) {
  if ((await db.timeEntry.count()) > 0) return;
  const people = await db.employee.findMany({ where: { lastName: { in: ["Meyer", "Richter", "Hoffmann", "Demir"] }, active: true }, select: { id: true, lastName: true } });
  if (people.length === 0) return;
  console.log("Demo-Daten (Zeiterfassung) werden angelegt …");
  const by = (lastName: string) => people.find((p) => p.lastName === lastName)?.id;
  const orderOf = async (status: string) => (await db.order.findFirst({ where: { status }, orderBy: { acceptedAt: "asc" }, select: { id: true } }))?.id ?? null;
  const [working, closed] = [await orderOf("in_progress"), await orderOf("picked_up")];

  const today = todayInput();
  const days: string[] = [];
  for (let back = 1; days.length < 6 && back < 14; back++) {
    const day = addDaysToKey(today, -back);
    if (weekdayOfKey(day) >= 1 && weekdayOfKey(day) <= 5) days.push(day);
  }
  const at = (day: string, time: string) => parseZoned(day, time) ?? new Date();

  for (const lastName of ["Meyer", "Hoffmann", "Demir"]) {
    const employeeId = by(lastName);
    if (!employeeId) continue;
    for (const [i, day] of days.entries()) {
      const onOrder = lastName === "Meyer" && i < 2;
      await db.timeEntry.create({ data: { employeeId, orderId: onOrder ? working : null, startedAt: at(day, "07:30"), endedAt: at(day, "12:00"), activity: onOrder ? "Inspektion" : "Werkstatt", source: "stamp" } });
      await db.timeEntry.create({
        data: {
          employeeId,
          orderId: lastName === "Meyer" && i === days.length - 1 ? closed : null,
          startedAt: at(day, "12:30"),
          endedAt: at(day, "16:00"),
          activity: lastName === "Demir" ? "Reifenservice" : "Werkstatt",
          source: "stamp",
          ...(lastName === "Meyer" && i === days.length - 1 && closed ? { transferredAt: at(day, "16:30") } : {}),
        },
      });
    }
  }

  // Nachgetragen (vergessen zu stempeln), mit Begründung im Verlauf
  const sven = by("Richter");
  if (sven && days[0]) {
    const entry = await db.timeEntry.create({ data: { employeeId: sven, startedAt: at(days[0], "08:00"), endedAt: at(days[0], "12:00"), activity: "Fahrzeugabholung", source: "manual" } });
    await db.timeCorrection.create({ data: { entryId: entry.id, kind: "create", reason: "Stempeln vergessen, Zeit aus dem Auftragsbuch übernommen.", byName: "Demo" } });
  }
  // Korrigiert (Ende zu früh gestempelt) und storniert (doppelt gebucht)
  const lena = by("Hoffmann");
  if (lena && days[1]) {
    const fixed = await db.timeEntry.findFirst({ where: { employeeId: lena, startedAt: at(days[1], "12:30") } });
    if (fixed) {
      await db.timeEntry.update({ where: { id: fixed.id }, data: { endedAt: at(days[1], "17:00"), note: "Kundengespräch im Anschluss" } });
      await db.timeCorrection.create({ data: { entryId: fixed.id, kind: "edit", reason: "Ende stand zu früh, Kundengespräch gehörte noch dazu.", byName: "Demo", prevStartedAt: fixed.startedAt, prevEndedAt: fixed.endedAt, prevBreakMinutes: 0, prevActivity: fixed.activity } });
    }
    const double = await db.timeEntry.create({ data: { employeeId: sven ?? lena, startedAt: at(days[2] ?? days[1], "18:00"), endedAt: at(days[2] ?? days[1], "18:20"), activity: "Doppelt gebucht", voidedAt: new Date() } });
    await db.timeCorrection.create({ data: { entryId: double.id, kind: "void", reason: "Doppelt gebucht, der Eintrag gilt nicht.", byName: "Demo", prevStartedAt: double.startedAt, prevEndedAt: double.endedAt, prevBreakMinutes: 0, prevActivity: double.activity } });
  }
  // Läuft gerade (Tom, seit anderthalb Stunden)
  const tom = by("Meyer");
  if (tom) await db.timeEntry.create({ data: { employeeId: tom, orderId: working, startedAt: new Date(Date.now() - 90 * 60_000), activity: "Bremsenwechsel", source: "stamp", runningKey: tom } });
}

export const seeds: SeedDef[] = [{ id: "time", feature: "office.time", order: 130, demo }];
