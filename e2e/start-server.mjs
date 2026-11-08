// Startet die gebaute App (npm run build) gegen ein frisches Datenverzeichnis .e2e-data – Migrationen, Basisdaten und Einrichtungs-Token
// entstehen wie im Betrieb beim Start. Die Browser-Tests richten die App dann über die Ersteinrichtung im Browser ein (e2e/global-setup.ts).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, ".e2e-data");
const port = process.env.E2E_PORT ?? "3100";
if (!existsSync(join(root, ".next", "BUILD_ID"))) {
  console.error("Die App ist nicht gebaut: erst  npm run build  (oder  npm run e2e:build), dann  npm run e2e.");
  process.exit(1);
}
rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });

const child = spawn(process.execPath, [join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-p", port, "-H", "127.0.0.1"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production", DATA_DIR: dataDir, DATABASE_URL: `file:${join(dataDir, "schrauberos.db")}`, TZ: "Europe/Berlin", NEXT_TELEMETRY_DISABLED: "1", SCHRAUBEROS_E2E: "1", NODE_TEST_CONTEXT: "child" },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
