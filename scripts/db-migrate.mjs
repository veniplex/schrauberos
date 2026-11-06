// Neue Datenbank-Migration erzeugen und auf die lokale Entwicklungsdatenbank anwenden:
//   npm run db:migrate -- <name>      z. B.  npm run db:migrate -- add_warranty
// Bereits veröffentlichte Migrationen werden nie verändert – nur neue kommen dazu (Voraussetzung für Web-Updates und
// bestehende Installationen). Migrationen sollten zum Code der Vorversion kompatibel sein (Rückfall beim Web-Update).
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const name = process.argv[2];
if (!name || !/^[a-z0-9_]+$/.test(name)) {
  console.error("Aufruf: npm run db:migrate -- <name>   (nur Kleinbuchstaben, Ziffern und Unterstriche)");
  process.exit(1);
}
const prisma = (...args) =>
  execFileSync(process.execPath, [resolve(root, "node_modules/prisma/build/index.js"), ...args], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? "file:./dev.db" },
  });
prisma("migrate", "dev", "--name", name);
prisma("generate"); // Client auf den neuen Stand bringen
