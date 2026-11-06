import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { claimed, versionOf } from "@/lib/concurrency";
import { runMigrations } from "./migrate";

/** Gleichzeitiges Arbeiten gegen eine echte SQLite-Datenbank (Migrationen wie im Betrieb). */
const dir = mkdtempSync(path.join(tmpdir(), "so-concurrency-"));
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

const claim = (id: string, version: string) => claimed(version, (stamp, next) => db.customer.updateMany({ where: { id, updatedAt: stamp }, data: { updatedAt: next } }));

describe("Gleichzeitiges Bearbeiten", () => {
  it("verhindert verlorene Änderungen: die zweite Speicherung mit alter Version scheitert", async () => {
    const c = await db.customer.create({ data: { lastName: "Müller" } });
    const opened = versionOf(c); // beide öffnen den Datensatz in diesem Zustand
    assert.equal(await claim(c.id, opened), true); // Person A speichert zuerst
    await db.customer.update({ where: { id: c.id }, data: { lastName: "Müller-Schmidt" } });
    assert.equal(await claim(c.id, opened), false); // Person B mit veralteter Version: Konflikt, nichts überschrieben
    assert.equal((await db.customer.findUniqueOrThrow({ where: { id: c.id } })).lastName, "Müller-Schmidt");
  });

  it("lässt bei vielen gleichzeitigen Speicherungen genau eine gewinnen", async () => {
    const c = await db.customer.create({ data: { lastName: "Wettlauf" } });
    const opened = versionOf(c);
    const results = await Promise.all(Array.from({ length: 12 }, () => claim(c.id, opened)));
    assert.equal(results.filter(Boolean).length, 1);
  });

  it("meldet Konflikt, wenn der Datensatz inzwischen gelöscht wurde", async () => {
    const c = await db.customer.create({ data: { lastName: "Weg" } });
    const opened = versionOf(c);
    await db.customer.delete({ where: { id: c.id } });
    assert.equal(await claim(c.id, opened), false);
  });

  it("Prüfen und Schreiben in einer Transaktion verhindert Doppelbelegungen bei gleichzeitigen Buchungen", async () => {
    const bay = await db.bay.create({ data: { name: "Hebebühne X" } });
    const startsAt = new Date("2030-01-01T08:00:00Z");
    const endsAt = new Date("2030-01-01T09:00:00Z");
    const book = (n: number) =>
      db.$transaction(async (tx) => {
        const clash = await tx.appointment.findFirst({ where: { bayId: bay.id, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } });
        if (clash) return false;
        await tx.appointment.create({ data: { title: `Termin ${n}`, startsAt, endsAt, bayId: bay.id } });
        return true;
      });
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => book(i)));
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(await db.appointment.count({ where: { bayId: bay.id } }), 1);
  });
});
