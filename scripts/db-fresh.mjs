// Löscht die lokale SQLite-Entwicklungsdatenbank und baut sie neu auf (Migrationen, Basisdaten, Entwicklungs-Admin, ggf. Beispieldaten).
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const f of ["dev.db", "dev.db-journal", "dev.db-wal", "dev.db-shm", "prisma/dev.db", "prisma/dev.db-journal"]) rmSync(resolve(root, f), { force: true });
execFileSync(process.execPath, [resolve(root, "node_modules/tsx/dist/cli.mjs"), "prisma/seed.ts"], { cwd: root, stdio: "inherit" });
