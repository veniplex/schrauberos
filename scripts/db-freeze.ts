// Eingefrorene Migrationen (siehe src/lib/migration-freeze.ts):
//   npm run db:freeze            beim Veröffentlichen: Baseline auf "frozen sha256:…" setzen, neue Migrationen mit Prüfsumme eintragen (danach committen)
//   npm run db:release-check     Pipeline bei einem Versions-Tag: alles eingefroren? Seit dem letzten eingefrorenen Release nur Neues hinzugekommen?
// Mit  --root <Ordner>  auf ein anderes Repository (Tests).
import { execFileSync } from "node:child_process";
import path from "node:path";
import { compareToRelease, freezeMigrations, parseBaselineMarker, PUBLISHED_FILE, verifyMigrations } from "../src/lib/migration-freeze";
import { BASELINE_NAME } from "../src/lib/migration-guard";

const args = process.argv.slice(2);
const command = args[0];
const rootIndex = args.indexOf("--root");
const root = rootIndex >= 0 ? path.resolve(args[rootIndex + 1]) : path.resolve(__dirname, "..");
const layout = { dir: path.join(root, "prisma", "migrations"), publishedFile: path.join(root, "prisma", PUBLISHED_FILE) };

const git = (...gitArgs: string[]) => execFileSync("git", gitArgs, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function fail(messages: string[]): never {
  for (const message of messages) console.error(`✖ ${message}`);
  process.exit(1);
}

if (command === "freeze") {
  try {
    const result = freezeMigrations(layout);
    console.log(result.baselineFrozen ? "Baseline eingefroren (frozen sha256:…)." : "Baseline war schon eingefroren.");
    console.log(result.added.length ? `Neu als veröffentlicht eingetragen: ${result.added.join(", ")}` : "Keine neuen Migrationen einzutragen.");
    console.log(`Bitte committen: prisma/migrations und prisma/${PUBLISHED_FILE}. Danach das Release-Tag setzen (README, Abschnitt „Eine Version veröffentlichen“).`);
  } catch (error) {
    fail([error instanceof Error ? error.message : String(error)]);
  }
} else if (command === "check-release") {
  const problems = verifyMigrations(layout, { release: true });
  if (problems.length) fail(problems);

  // Letztes früheres Release-Tag, dessen Baseline schon eingefroren war (ältere Tags, z. B. 0.1.0, hatten eine andere Historie)
  const current = args.includes("--tag") ? args[args.indexOf("--tag") + 1] : (process.env.GITHUB_REF_NAME ?? "");
  const tags = git("tag", "--list", "v*", "--sort=-v:refname").split(/\r?\n/).filter((tag) => tag && tag !== current);
  let compared = "";
  for (const tag of tags) {
    let baseline = "";
    try {
      baseline = git("show", `${tag}:prisma/migrations/${BASELINE_NAME}/migration.sql`);
    } catch {
      continue;
    }
    if (parseBaselineMarker(baseline)?.state !== "frozen") continue;
    const changes = git("diff", "--name-status", "--no-renames", tag, "HEAD", "--", "prisma/migrations");
    const wrong = compareToRelease(changes);
    if (wrong.length) fail(wrong.map((line) => `gegenüber ${tag}: ${line}`));
    compared = tag;
    break;
  }
  console.log(compared ? `Migrationen sind eingefroren; gegenüber ${compared} ist nur Neues hinzugekommen.` : "Migrationen sind eingefroren (kein früheres eingefrorenes Release zum Vergleichen).");
} else {
  fail(["Aufruf: db-freeze.ts freeze | check-release [--tag vX.Y.Z] [--root <Ordner>]"]);
}
