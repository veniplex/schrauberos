// Drift-Check: stimmt prisma/schema.prisma mit dem Ergebnis aller Migrationen überein? (Prisma legt dafür selbst eine
// Wegwerf-Datenbank an.) Läuft lokal und in der Pipeline:  npm run db:check
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(process.execPath, [resolve(root, "node_modules/prisma/build/index.js"), "migrate", "diff", "--from-migrations", "prisma/migrations", "--to-schema", "prisma/schema.prisma", "--exit-code"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? "file:./dev.db" },
});
if (result.status === 0) {
  console.log("Schema und Migrationen stimmen überein.");
} else if (result.status === 2) {
  console.error("\nDrift: Das Schema (prisma/schema.prisma) weicht von den Migrationen ab.");
  console.error("Vor der Veröffentlichung: npm run db:baseline – danach: npm run db:migrate -- <name> (siehe README, Abschnitt Migrationen).");
} else {
  console.error("Der Drift-Check konnte nicht ausgeführt werden.");
}
process.exit(result.status ?? 1);
