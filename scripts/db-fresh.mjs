// Löscht die lokale SQLite-Entwicklungsdatenbank, legt sie aus der Baseline neu an und seedet sie (inkl. Demo-Daten laut .env).
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const f of ["prisma/dev.db", "prisma/dev.db-journal", "dev.db", "dev.db-journal"]) rmSync(resolve(root, f), { force: true });
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
execFileSync(npx, ["prisma", "migrate", "deploy"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
execFileSync(npx, ["prisma", "db", "seed"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
