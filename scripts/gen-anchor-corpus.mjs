// Erzeugt den Goldkorpus des Starter-Vertrauensankers neu (src/lib/updates/testdata/anchor/cases.json).
//   node scripts/gen-anchor-corpus.mjs            schreibt die Datei
//   node scripts/gen-anchor-corpus.mjs --check    bricht ab, wenn die eingecheckte Datei abweicht
// Die Fälle sind in src/lib/updates/testdata/anchor/build-corpus.ts beschrieben (mit Testschlüsseln, deterministisch).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCorpus, corpusToJson } from "../src/lib/updates/testdata/anchor/build-corpus.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = resolve(root, "src/lib/updates/testdata/anchor/cases.json");
const json = corpusToJson(await buildCorpus());
if (process.argv.includes("--check")) {
  if (readFileSync(file, "utf8") !== json) {
    console.error("cases.json weicht von build-corpus.ts ab – `node scripts/gen-anchor-corpus.mjs` ausführen und einchecken.");
    process.exit(1);
  }
  console.log("cases.json ist aktuell.");
} else {
  writeFileSync(file, json);
  console.log(`cases.json geschrieben (${json.length} Bytes).`);
}
