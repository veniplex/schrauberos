import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { dayKey } from "@/lib/zone";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Saisonlogik der Reifenliste gegen die echte Datenbank: Das Winterfenster aus den Einstellungen bestimmt, welcher Satz „Wechsel fällig“ ist (gelagert, passende Saison, kein Termin)
 * und welcher montierte Satz zur falschen Saison gehört. Das Fenster wird um den aktuellen Monat gelegt, damit der Test an jedem Tag dasselbe prüft.
 */
let env: TestEnv;
let queries: typeof import("./queries");
let carId: string;

before(async () => {
  env = await createTestEnv();
  queries = await import("./queries");
  carId = (await env.db.vehicle.create({ data: { plate: "B AB 1", plateNorm: "BAB1" } })).id;
});
after(() => env.cleanup());
beforeEach(async () => {
  await env.db.appointment.deleteMany();
  await env.db.tireSet.deleteMany();
});

// Monat in der Werkstatt-Zone (nicht der Prozess-Zone: am Monatsende abends ein anderer Monat)
const thisMonth = Number(dayKey(new Date()).slice(5, 7));
const nextMonth = (thisMonth % 12) + 1;
const setWindow = (winterStartMonth: number, winterEndMonth: number) =>
  env.db.tireSettings.upsert({ where: { id: "default" }, update: { winterStartMonth, winterEndMonth }, create: { id: "default", winterStartMonth, winterEndMonth } });
const make = (season: string, status: string) => env.db.tireSet.create({ data: { vehicleId: carId, season, status } });
const flags = async () => Object.fromEntries((await queries.listTireSets()).map((s) => [`${s.season}/${s.status}`, { swapDue: s.swapDue, wrongSeason: s.wrongSeason }]));

describe("Saison der Reifenliste", () => {
  it("jetzt Winter: gelagerter Winter-Satz ist „Wechsel fällig“, montierter Sommer-Satz gehört zur falschen Saison", async () => {
    await setWindow(thisMonth, thisMonth);
    await make("winter", "stored");
    await make("summer", "mounted");
    const f = await flags();
    assert.deepEqual(f["winter/stored"], { swapDue: true, wrongSeason: false });
    assert.deepEqual(f["summer/mounted"], { swapDue: false, wrongSeason: true });
  });

  it("jetzt Sommer (Fenster einen Monat weiter): umgekehrt", async () => {
    await setWindow(nextMonth, nextMonth);
    await make("summer", "stored");
    await make("winter", "mounted");
    const f = await flags();
    assert.deepEqual(f["summer/stored"], { swapDue: true, wrongSeason: false });
    assert.deepEqual(f["winter/mounted"], { swapDue: false, wrongSeason: true });
  });

  it("Ganzjahressätze und montierte Sätze der passenden Saison lösen weder Wechsel noch Hinweis aus; Entsorgte nie", async () => {
    await setWindow(thisMonth, thisMonth);
    await make("allseason", "stored");
    await make("allseason", "mounted");
    await make("winter", "mounted");
    await make("summer", "disposed");
    const f = await flags();
    assert.deepEqual(f["allseason/stored"], { swapDue: false, wrongSeason: false });
    assert.deepEqual(f["allseason/mounted"], { swapDue: false, wrongSeason: false });
    assert.deepEqual(f["winter/mounted"], { swapDue: false, wrongSeason: false });
    assert.deepEqual(f["summer/disposed"], { swapDue: false, wrongSeason: false });
  });

  it("ein offener Termin nimmt „Wechsel fällig“ zurück, ein erledigter nicht", async () => {
    await setWindow(thisMonth, thisMonth);
    const set = await make("winter", "stored");
    const startsAt = new Date(Date.now() + 86_400_000);
    await env.db.appointment.create({ data: { title: "Wechsel", startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000), tireSetId: set.id, vehicleId: carId, status: "scheduled" } });
    assert.equal((await flags())["winter/stored"].swapDue, false);
    await env.db.appointment.updateMany({ data: { status: "done" } });
    assert.equal((await flags())["winter/stored"].swapDue, true);
  });
});
