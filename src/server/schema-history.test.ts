import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { runMigrations } from "./migrate";

/**
 * Schema-Regeln vor dem Freeze (Z7): `onDelete` lässt sich nach der Veröffentlichung nicht mehr ändern, und eine NOT-NULL-Spalte `updatedAt` lässt sich nicht mehr nachrüsten.
 * Deshalb prüft dieser Test das Schema selbst und gegen eine echte Datenbank:
 *  - Historie (Abwesenheiten, Führerscheinkontrollen, Kilometerstände, Kosten, Reifensätze) verschwindet nie still mit ihrem Elternsatz (`Restrict`);
 *  - jedes verbleibende `Cascade` trägt eine begründende Anmerkung;
 *  - jede Konfigurationstabelle mit Bearbeiten-Formular hat `updatedAt` (Versionssperre, `claimRow`).
 */
const schema = readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8").replace(/\r\n/g, "\n");

function relationLines(): Array<{ model: string; line: string }> {
  const out: Array<{ model: string; line: string }> = [];
  let model = "";
  for (const line of schema.split("\n")) {
    const m = /^model (\w+) \{/.exec(line);
    if (m) model = m[1]!;
    if (/^\}/.test(line)) model = "";
    if (model && line.includes("@relation(") && line.includes("onDelete:")) out.push({ model, line });
  }
  return out;
}

describe("Schema: Löschverhalten und Versionen", () => {
  it("jedes Cascade ist begründet (Anmerkung „// Cascade: …“ am Feld)", () => {
    const bad = relationLines().filter(({ line }) => line.includes("onDelete: Cascade") && !/\/\/ Cascade: \S/.test(line));
    assert.deepEqual(bad.map((b) => `${b.model}: ${b.line.trim()}`), []);
  });

  it("Historie hängt per Restrict am Elternsatz", () => {
    const restrict = (model: string, field: string) => {
      const row = relationLines().find((r) => r.model === model && new RegExp(`^\\s*${field}\\s`).test(r.line));
      assert.ok(row, `${model}.${field} hat eine Relation`);
      assert.match(row.line, /onDelete: Restrict/, `${model}.${field}`);
    };
    restrict("Absence", "employee");
    restrict("FleetLicenseCheck", "employee");
    restrict("FleetMileage", "fleetVehicle");
    restrict("FleetCost", "fleetVehicle");
    restrict("TireSet", "vehicle");
    restrict("TimeEntry", "employee");
  });

  it("jeder Fremdschlüssel hat einen führenden Index (Löschen und Verknüpfen suchen sonst die ganze Tabelle ab)", () => {
    const missing: string[] = [];
    for (const m of schema.matchAll(/^model (\w+) \{\n([\s\S]*?)\n\}/gm)) {
      const [, model, body] = m;
      for (const rel of body!.matchAll(/@relation\((?:"[^"]*",\s*)?fields:\s*\[([^\]]+)\]/g)) {
        const first = rel[1]!.split(",")[0]!.trim();
        const lead = new RegExp(`@@(index|unique|id)\\(\\[${first}\\b`).test(body!);
        const field = new RegExp(`^\\s*${first}\\s+\\S+.*@(unique|id)\\b`, "m").test(body!);
        if (!lead && !field) missing.push(`${model}.${first}`);
      }
    }
    assert.deepEqual(missing, []);
  });

  it("die sechs bearbeitbaren Konfigurationstabellen haben updatedAt (Versionssperre)", () => {
    for (const model of ["Bay", "AppointmentType", "NetLocation", "NetVlan", "NetSubnet", "DocCategory"]) {
      const body = new RegExp(`model ${model} \\{\\n([\\s\\S]*?)\\n\\}`).exec(schema)?.[1] ?? "";
      assert.match(body, /updatedAt\s+DateTime\s+@updatedAt/, model);
    }
  });
});

describe("Schema: Restrict gegen eine echte Datenbank", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "so-schema-history-"));
  const file = path.join(dir, "test.db");
  let db: PrismaClient;
  before(async () => {
    await runMigrations(file);
    db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${file}` }) });
  });
  after(async () => {
    await db.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  it("Mitarbeiter mit Abwesenheit oder Führerscheinkontrolle, Fahrzeug mit Kilometerstand, Kosten oder Reifensatz lassen sich nicht löschen", async () => {
    const day = new Date("2030-01-07T12:00:00Z");
    const emp = await db.employee.create({ data: { firstName: "A", lastName: "B" } });
    await db.absence.create({ data: { employeeId: emp.id, type: "vacation", startDate: day, endDate: day } });
    await assert.rejects(() => db.employee.delete({ where: { id: emp.id } }), /Foreign key/);
    await db.absence.deleteMany();
    await db.fleetLicenseCheck.create({ data: { employeeId: emp.id, checkedAt: day, nextDue: day } });
    await assert.rejects(() => db.employee.delete({ where: { id: emp.id } }), /Foreign key/);
    await db.fleetLicenseCheck.deleteMany();
    await db.employee.delete({ where: { id: emp.id } });

    const car = await db.fleetVehicle.create({ data: { plate: "B XX 1" } });
    await db.fleetMileage.create({ data: { fleetVehicleId: car.id, date: day, km: 1 } });
    await assert.rejects(() => db.fleetVehicle.delete({ where: { id: car.id } }), /Foreign key/);
    await db.fleetMileage.deleteMany();
    await db.fleetCost.create({ data: { fleetVehicleId: car.id, date: day, category: "fuel", amountCents: 1 } });
    await assert.rejects(() => db.fleetVehicle.delete({ where: { id: car.id } }), /Foreign key/);
    await db.fleetCost.deleteMany();
    await db.fleetVehicle.delete({ where: { id: car.id } });

    const vehicle = await db.vehicle.create({ data: { plate: "B YY 2", plateNorm: "BYY2" } });
    await db.tireSet.create({ data: { vehicleId: vehicle.id, season: "winter" } });
    await assert.rejects(() => db.vehicle.delete({ where: { id: vehicle.id } }), /Foreign key/);
  });
});
