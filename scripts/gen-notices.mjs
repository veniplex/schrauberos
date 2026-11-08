// Erzeugt THIRD-PARTY-NOTICES.md für das Paketverzeichnis (/bundle im Dockerfile):
//   node scripts/gen-notices.mjs <paketverzeichnis> [--out <datei>]
// Das Paket bündelt Pakete von npm (MIT, ISC, BSD, Apache-2.0 … verlangen bei Weitergabe als Binärdatei den Hinweis) und Laufzeitbibliotheken des Basisimages (glibc, libstdc++ …, deren Lizenztexte
// und der Hinweis auf den Quelltext gehören dazu). Die Datei listet je npm-Paket Name, Version, Lizenz und Herkunft (aus dessen package.json im Paket) und hängt die Lizenzdateien an, die im Build-Image
// liegen (`/usr/share/doc/<paket>/copyright`, soweit vorhanden). Schlüsselfrei, ohne Abhängigkeiten, läuft auf Linux wie Windows; sie ändert nichts am Paket außer der einen Ausgabedatei.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Pakete des Basisimages, deren Bibliotheken im Paket unter `runtime/lib` liegen (Lizenztexte, soweit vorhanden). */
export const RUNTIME_PACKAGES = ["libc6", "libstdc++6", "libgcc-s1", "libc-bin"];

/** Alle Pakete unter `node_modules` (auch gescopte), ohne die Unterordner verschachtelter `node_modules`. */
export function listPackages(root) {
  const modules = join(root, "node_modules");
  if (!existsSync(modules)) return [];
  const found = [];
  const readPackage = (dir) => {
    const file = join(dir, "package.json");
    if (!existsSync(file)) return;
    try {
      const pkg = JSON.parse(readFileSync(file, "utf8"));
      if (pkg.name) found.push({ name: pkg.name, version: pkg.version ?? "?", license: licenseOf(pkg), home: homeOf(pkg), dir });
    } catch {
      /* unlesbare package.json: nicht aufgeführt */
    }
  };
  const walk = (base) => {
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const dir = join(base, entry.name);
      if (entry.name.startsWith("@")) walk(dir);
      else {
        readPackage(dir);
        const nested = join(dir, "node_modules");
        if (existsSync(nested) && statSync(nested).isDirectory()) walk(nested);
      }
    }
  };
  walk(modules);
  return found.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function licenseOf(pkg) {
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license && typeof pkg.license.type === "string") return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => (typeof l === "string" ? l : l.type)).filter(Boolean).join(" OR ") || "unbekannt";
  return "unbekannt";
}

function homeOf(pkg) {
  const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  return String(pkg.homepage ?? repo ?? "").replace(/^git\+/, "");
}

export function buildNotices(root, options = {}) {
  const docs = options.docsDir ?? "/usr/share/doc";
  const packages = listPackages(root);
  const lines = [
    "# Hinweise zu Drittsoftware (Third-Party Notices)",
    "",
    "SchrauberOS bündelt die folgenden Pakete. Ihre Lizenzen gelten für den jeweiligen Teil; die Lizenztexte liegen in den Paketordnern unter `node_modules` bzw. am Ende dieser Datei.",
    "",
    "## npm-Pakete",
    "",
    "| Paket | Version | Lizenz | Herkunft |",
    "| --- | --- | --- | --- |",
    ...packages.map((p) => `| ${p.name} | ${p.version} | ${p.license} | ${p.home} |`),
    "",
    "## Laufzeit (Node.js und Systembibliotheken)",
    "",
    "Das Paket enthält `runtime/node` (Node.js, MIT-Lizenz und Lizenzen seiner Abhängigkeiten, siehe https://github.com/nodejs/node/blob/main/LICENSE) und unter `runtime/lib` die Bibliotheken des Debian-Basisimages",
    "(GNU C Library unter LGPL-2.1 oder später, GCC-Laufzeitbibliotheken unter GPL-3.0 mit GCC Runtime Library Exception, Namensauflösung `libnss_*`). Den Quelltext dieser Pakete stellt das Debian-Projekt bereit",
    "(https://sources.debian.org/ bzw. `apt-get source <paket>`); auf Anfrage liefert ihn der Betreiber dieses Pakets.",
    "",
  ];
  for (const name of RUNTIME_PACKAGES) {
    const file = join(docs, name, "copyright");
    if (!existsSync(file)) continue;
    lines.push(`### Debian-Paket ${name}`, "", "```text", readFileSync(file, "utf8").replace(/\r\n/g, "\n").trimEnd(), "```", "");
  }
  return { text: `${lines.join("\n")}\n`, packages: packages.length };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const dir = process.argv[2];
  if (!dir || !statSync(dir).isDirectory()) throw new Error("Aufruf: node scripts/gen-notices.mjs <paketverzeichnis> [--out <datei>]");
  const outIndex = process.argv.indexOf("--out");
  const out = outIndex > 0 ? process.argv[outIndex + 1] : join(dir, "THIRD-PARTY-NOTICES.md");
  const { text, packages } = buildNotices(resolve(dir));
  writeFileSync(out, text);
  console.log(`THIRD-PARTY-NOTICES.md: ${packages} Pakete → ${out}`);
}
