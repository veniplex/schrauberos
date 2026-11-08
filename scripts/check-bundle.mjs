// Prüft das zusammengestellte Paketverzeichnis (/bundle im Dockerfile, bevor SOS-TREE erzeugt wird):
//   node scripts/check-bundle.mjs <verzeichnis>
// Es darf nichts darin liegen, was nicht zur Laufzeit gehört (Quelltext, Tests, Umgebungsdateien, Datenbanken, Werkzeuge), und es muss alles darin liegen, was die App zur Laufzeit liest
// (Hilfe-Markdown, Schrift, Migrationen, statische Dateien, Laufzeit, Launcher). `next build` (output: "standalone") kopiert je nach Ablaufverfolgung auch Quelldateien und `.env` mit; das Dockerfile
// räumt sie weg und lässt dieses Skript gegenprüfen – ein Befund bricht den Image-Bau ab. Schlüsselfrei, ohne Abhängigkeiten.
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Pfade (relativ zur Wurzel), die im Paket nicht vorkommen dürfen. */
export const FORBIDDEN_PATHS = ["src", "e2e", "scripts", "docker", ".data", ".git", ".github", ".claude", ".hallmark", "test-results", "playwright-report", "playwright.config.ts", "README.md", "CLAUDE.md", "AGENTS.md", "Dockerfile", "tsconfig.json", "prisma/schema.prisma", "prisma.config.ts", "next.config.ts", "package-lock.json"];
/** Pfade, die zur Laufzeit gelesen werden (Datei oder Ordner). */
export const REQUIRED_PATHS = [
  "server.js",
  "package.json",
  ".next/BUILD_ID",
  ".next/server",
  ".next/static",
  "public",
  "docs/platform",
  "assets/fonts/NotoSans-Regular.ttf",
  "assets/fonts/NotoSans-Bold.ttf",
  "prisma/migrations/00000000000000_baseline/migration.sql",
  "version.json",
  "launcher.mjs",
  "runtime/node",
  "runtime/loader",
  "runtime/lib",
  "node_modules/next",
  "node_modules/better-sqlite3/package.json",
];

const forbiddenName = (name) => /^\.env(\..*)?$/.test(name) || /\.(db|db-wal|db-shm|db-journal|sqlite)$/.test(name) || name === "secret.key" || name === "setup-token";
const testFile = (name) => /\.(test|spec)\.(ts|tsx|js|mjs|cjs)$/.test(name);

/** Liefert die Befunde (leer = in Ordnung). Läuft auf `lstat`, folgt keinem Link. */
export function checkBundle(root) {
  const problems = [];
  for (const p of FORBIDDEN_PATHS) if (existsSync(join(root, p))) problems.push(`nicht erlaubt: ${p}`);
  for (const p of REQUIRED_PATHS) if (!existsSync(join(root, p))) problems.push(`fehlt: ${p}`);
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      // Pakete in node_modules bringen ihre eigenen Testdateien mit; dort gilt nur die Namensregel für Umgebungs-/Datenbankdateien
      const inModules = r.startsWith("node_modules/") || r.includes("/node_modules/");
      if (forbiddenName(entry.name) && !(inModules && entry.name.startsWith(".env"))) problems.push(`nicht erlaubt: ${r}`);
      else if (!inModules && testFile(entry.name)) problems.push(`Testdatei: ${r}`);
      // Modi gibt es nur unter Linux (Image-Bau); unter Windows meldet lstat für alles 666
      if (process.platform !== "win32" && !entry.isSymbolicLink()) {
        const mode = lstatSync(join(dir, entry.name)).mode;
        if ((mode & 0o022) !== 0) problems.push(`schreibbar für Gruppe/Andere: ${r}`);
        if ((mode & 0o7000) !== 0) problems.push(`Setuid/Setgid/Sticky: ${r}`);
      }
      if (entry.isDirectory()) walk(join(dir, entry.name), r);
    }
  };
  walk(root, "");
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
  const dir = process.argv[2];
  if (!dir) throw new Error("Aufruf: node scripts/check-bundle.mjs <verzeichnis>");
  if (!lstatSync(dir).isDirectory()) throw new Error(`${dir} ist kein Verzeichnis.`);
  const problems = checkBundle(resolve(dir));
  if (problems.length > 0) {
    console.error(`Paketverzeichnis ${dir}: ${problems.length} Befund(e)`);
    for (const p of problems.slice(0, 50)) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(`Paketverzeichnis ${dir}: in Ordnung (${REQUIRED_PATHS.length} Pflichtpfade vorhanden, nichts Unzulässiges).`);
}
