import "dotenv/config";
import { defineConfig } from "prisma/config";

// Lokal: SQLite (file:...). Produktion/Docker: PostgreSQL (postgres://...).
// Der Provider wird anhand der DATABASE_URL gewählt; beide Schemas stammen aus einer Quelle
// (prisma/schema.prisma) – das Postgres-Schema wird per `npm run db:sync-pg` abgeleitet.
const url = process.env.DATABASE_URL ?? "file:./dev.db";
const isPostgres = /^postgres(ql)?:/.test(url);

export default defineConfig({
  schema: isPostgres ? "prisma/postgres/schema.prisma" : "prisma/schema.prisma",
  migrations: {
    path: isPostgres ? "prisma/postgres/migrations" : "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: { url },
});
