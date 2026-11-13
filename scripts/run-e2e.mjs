// Browser-Tests in zwei Läufen (siehe playwright.config.ts, `E2E_SCREENSHOTS`): erst die Baseline-Screenshots gegen frisch eingerichtete, unberührte Demo-Daten,
// dann alle übrigen Tests gegen eine neue App. Beide Läufe werden immer ausgeführt; der Exit-Wert ist ≠ 0, wenn einer fehlschlägt.
//   npm run e2e                 beide Läufe
//   npm run e2e -- --project=desktop      Argumente gehen an beide Läufe
//   npx playwright test <Datei>           gezielt (ein Lauf, alles wie angegeben) – oder `npm run e2e -- <Datei>`
// Mit E2E_SCREENSHOTS=only|skip oder einer Dateiangabe läuft nur ein Lauf; E2E_UPDATE_SNAPSHOTS=1 gilt nur für den Screenshot-Lauf.
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "node_modules", "@playwright", "test", "cli.js");
const args = process.argv.slice(2);

const run = (env) => spawnSync(process.execPath, [cli, "test", ...args], { cwd: root, stdio: "inherit", env: { ...process.env, ...env } }).status ?? 1;

const targeted = process.env.E2E_SCREENSHOTS || args.some((a) => !a.startsWith("-") && !/^\d+$/.test(a));
if (targeted) process.exit(run({}));

console.log("== Lauf 1 von 2: Baseline-Screenshots (frische Demo-Daten) ==");
const screenshots = run({ E2E_SCREENSHOTS: "only" });
console.log("== Lauf 2 von 2: alle übrigen Browser-Tests ==");
const rest = run({ E2E_SCREENSHOTS: "skip", E2E_UPDATE_SNAPSHOTS: "0" });
process.exit(screenshots === 0 && rest === 0 ? 0 : 1);
