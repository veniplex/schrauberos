import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Erzeugt den Prisma-Client passend zur DATABASE_URL:
 *  file:...       -> SQLite (lokale Entwicklung)
 *  postgres(ql):  -> PostgreSQL (Docker/Produktion)
 * Bewusst ohne `server-only`, damit auch das Seed-Skript (tsx) ihn nutzen kann.
 */
export function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  const adapter = /^postgres(ql)?:/.test(url)
    ? new PrismaPg({ connectionString: url })
    : new PrismaBetterSqlite3({ url });
  return new PrismaClient({ adapter });
}
