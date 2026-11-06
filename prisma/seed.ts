import "dotenv/config";
import { scryptHash } from "../src/server/auth/scrypt";
import { createPrismaClient, databaseFile } from "../src/server/db-client";
import { runMigrations } from "../src/server/migrate";
import { ensureBaseData } from "../src/server/seed/base";
import { seedAllDemo } from "../src/server/seed/demo";

/**
 * Seed für die lokale Entwicklung (`npm run db:fresh`, `prisma db seed`): Basisdaten, ein Entwicklungs-Admin und
 * Beispieldaten. In Produktion gibt es das nicht – dort richtet man den Administrator beim ersten Aufruf im Browser ein.
 */
const db = createPrismaClient();

async function seedAdmin() {
  if ((await db.user.count()) > 0) return;
  const username = (process.env.SEED_ADMIN_USER ?? "admin").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? "admin";
  const adminRole = await db.role.findUniqueOrThrow({ where: { key: "admin" } });
  await db.user.create({
    data: { username, name: "Administrator", passwordHash: await scryptHash(password), mustChangePassword: false, roles: { create: [{ roleId: adminRole.id }] } },
  });
  console.log(`Entwicklungs-Admin angelegt: ${username}`);
}

async function main() {
  await runMigrations(databaseFile());
  const { fresh } = await ensureBaseData(db);
  await seedAdmin();
  if (fresh && process.env.SEED_DEMO === "true") {
    await seedAllDemo(db);
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
