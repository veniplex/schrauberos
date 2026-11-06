import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { databaseFile } from "./db-client-path";

export { databaseFile };

/**
 * Erzeugt den Prisma-Client für die SQLite-Datenbank (DATABASE_URL).
 * Bewusst ohne `server-only`, damit auch das Seed-Skript (tsx) ihn nutzen kann.
 */
export function createPrismaClient(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${databaseFile()}` }) });
}
