// Schreibt die Symbole der installierbaren App nach public/icons/ (Quelle und Verfahren: scripts/lib/pwa-icons.mjs).
//   node scripts/gen-pwa-icons.mjs           erzeugt die Dateien
//   node scripts/gen-pwa-icons.mjs --check   prüft, dass die Dateien dem Verfahren entsprechen (Bildpunkte), schreibt nichts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng, ICONS, renderIcon } from "./lib/pwa-icons.mjs";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const check = process.argv.includes("--check");
let bad = 0;
if (!check) mkdirSync(out, { recursive: true });
for (const icon of ICONS) {
  const rgba = renderIcon(icon);
  const file = resolve(out, icon.file);
  if (check) {
    const same =
      existsSync(file) &&
      (() => {
        const decoded = decodePng(readFileSync(file));
        return decoded.size === icon.size && decoded.rgba.equals(rgba);
      })();
    if (!same) {
      console.error(`veraltet oder fehlt: public/icons/${icon.file}`);
      bad++;
    }
  } else {
    writeFileSync(file, encodePng(icon.size, rgba));
    console.log(`public/icons/${icon.file} (${icon.size} × ${icon.size})`);
  }
}
if (bad) process.exit(1);
