// Leitet prisma/postgres/schema.prisma aus prisma/schema.prisma (SQLite) ab.
// Nur Provider und relativer Output-Pfad unterscheiden sich.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");

if (!source.includes('provider = "sqlite"')) {
  throw new Error('prisma/schema.prisma muss `provider = "sqlite"` verwenden.');
}

const pg = source
  .replace('provider = "sqlite"', 'provider = "postgresql"')
  .replace('output   = "../src/generated/prisma"', 'output   = "../../src/generated/prisma"')
  .replace(/^\/\/ Quelle der Wahrheit[^\n]*\n/, "// GENERIERT aus ../schema.prisma via `npm run db:sync-pg` – nicht von Hand ändern.\n");

mkdirSync(resolve(root, "prisma/postgres"), { recursive: true });
writeFileSync(resolve(root, "prisma/postgres/schema.prisma"), pg);
console.log("prisma/postgres/schema.prisma aktualisiert.");
