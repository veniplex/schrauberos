// Erzeugt die Dateiliste SOS-TREE eines Paketverzeichnisses (läuft im Image-Bau, Dockerfile, nachdem /bundle zusammengestellt ist):
//   node scripts/gen-tree.mjs <verzeichnis>
// Schlüsselfrei. Bricht laut ab bei Sonderdateien, Setuid/Setgid/Sticky, unzulässigen Namen und Symlinks, die den Baum verlassen – ein Paket, das der Starter
// später ablehnen würde, soll gar nicht erst entstehen. Zur Gegenprobe wird die geschriebene Liste sofort wieder gelesen und gegen das Verzeichnis geprüft.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateTree, nodeFs, parseTree, serializeTree, TREE_FILE, treeStats, verifyTreeAgainstFs } from "../src/lib/updates/tree.ts";

const dir = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Aufruf: node scripts/gen-tree.mjs <verzeichnis>");

rmSync(resolve(dir, TREE_FILE), { force: true });
const entries = await generateTree(nodeFs(dir));
const tree = serializeTree(entries);
writeFileSync(resolve(dir, TREE_FILE), tree);

const failure = await verifyTreeAgainstFs(nodeFs(dir), parseTree(readFileSync(resolve(dir, TREE_FILE))));
if (failure) throw new Error(`Gegenprobe fehlgeschlagen (${failure.reason}: ${failure.path}).`);
const stats = treeStats(entries);
console.log(`${TREE_FILE}: ${stats.entries} Einträge, ${stats.bytes} Bytes Dateiinhalt, Liste ${tree.length} Bytes.`);
