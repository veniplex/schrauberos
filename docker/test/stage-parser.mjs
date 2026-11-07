// Stufe „parser“: Differentialtest der Format-Parser (Siegel-Rumpf, Dateiliste) – C gegen den TypeScript-Referenzprüfer.
// Mutierte Texte werden **gültig signiert** (Testschlüssel), damit sie die Signaturprüfung passieren und den Parser hinter ihr erreichen; beide Prüfer müssen gleich urteilen
// (Exit-Code, Grund; Pfad, wo eindeutig). Deterministisch (feste Saat), Anzahl mit --count N änderbar (Standard je 1500).
import { createHash, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { materializeCorpusCase } from "../../src/lib/updates/testdata/anchor/corpus-fs.ts";
import { TEST_RELEASE } from "../../src/lib/updates/testdata/anchor/test-keys.ts";
import { createSeal, SEAL_CONTEXT, sealFieldsFor } from "../../src/lib/updates/seal.ts";
import { parseTree } from "../../src/lib/updates/tree.ts";
import { buildStarter, removeTree, tempDir } from "./lib.mjs";
import { corpus, disagreement, judgeBoth } from "./stage-corpus.mjs";

/** Kleiner deterministischer Zufallsgenerator (xorshift128+ über SHA-256 gesät). */
export function prng(seedText) {
  const h = createHash("sha256").update(seedText).digest();
  let s0 = h.readBigUInt64LE(0) | 1n;
  let s1 = h.readBigUInt64LE(8) | 1n;
  const mask = (1n << 64n) - 1n;
  const next = () => {
    let x = s0;
    const y = s1;
    s0 = y;
    x ^= (x << 23n) & mask;
    s1 = x ^ y ^ (x >> 17n) ^ (y >> 26n);
    return Number(((s1 + y) & mask) >> 11n);
  };
  const int = (n) => next() % n;
  return { int, pick: (list) => list[int(list.length)], chance: (p) => int(1000) < p * 1000 };
}

const JUNK = ["", "0", "00", "01", "1", "-1", "+1", "1.0", "1e3", "999999999999999999999", "99999999999999999", "0x10", " 1", "1 ", "A", "a", "ａ", "\r", "\t", "\u0000", "é", "0123456789abcdef", "-", "/", "..", "x".repeat(300)];
const SEAL_NAMES = ["version", "base", "arch", "tree-sha512", "tree-size", "tree-entries", "tree-bytes"];

function mutateBody(rand, body) {
  const lines = body.split("\n");
  lines.pop(); // letztes leeres Stück
  const times = 1 + rand.int(3);
  for (let t = 0; t < times; t++) {
    const i = rand.int(lines.length);
    switch (rand.int(9)) {
      case 0: // Wert ersetzen
        lines[i] = lines[i].replace(/ .*$/, " " + rand.pick(JUNK));
        break;
      case 1: // Zeile löschen
        lines.splice(i, 1);
        break;
      case 2: // Zeile verdoppeln
        lines.splice(i, 0, lines[i]);
        break;
      case 3: // Zeilen tauschen
        {
          const j = rand.int(lines.length);
          [lines[i], lines[j]] = [lines[j], lines[i]];
        }
        break;
      case 4: // fremde Zeile einfügen
        lines.splice(i, 0, rand.pick(["extra 1", "", "version", " version 1.2.3", "tree-size 1\r"]));
        break;
      case 5: // Namen ändern
        lines[i] = lines[i].replace(/^[^ ]*/, rand.pick([...SEAL_NAMES, "Version", "bas", "", "tree_size"]));
        break;
      case 6: // ein Zeichen ändern
        if (lines[i].length) {
          const k = rand.int(lines[i].length);
          lines[i] = lines[i].slice(0, k) + String.fromCharCode(32 + rand.int(95)) + lines[i].slice(k + 1);
        }
        break;
      case 7: // Leerzeichen am Ende / zwei Leerzeichen
        lines[i] = rand.chance(0.5) ? lines[i] + " " : lines[i].replace(" ", "  ");
        break;
      default: // Kopfzeile ändern
        lines[0] = rand.pick(["schrauberos-seal 2", "schrauberos-seal 1 ", "Schrauberos-seal 1", ""]);
    }
  }
  return lines.join("\n") + (rand.chance(0.9) ? "\n" : "");
}

/** Siegel, Form A, mit beliebigem Rumpf gültig signiert. */
function signedSealWithBody(body) {
  const part = Buffer.from(`${body}signing-key ${TEST_RELEASE.publicHex}\n`, "latin1");
  const signature = sign(null, Buffer.concat([Buffer.from(SEAL_CONTEXT), part]), TEST_RELEASE.privatePem);
  return Buffer.concat([part, Buffer.from(`signature ${signature.toString("hex")}\n`)]);
}

function mutateTree(rand, text) {
  const lines = text.split("\n");
  lines.pop();
  const header = lines.splice(0, 2);
  const times = 1 + rand.int(3);
  const hex = (n) => rand.pick("0123456789abcdef").repeat(n);
  for (let t = 0; t < times; t++) {
    const i = rand.int(Math.max(1, lines.length));
    switch (rand.int(14)) {
      case 0:
        lines.splice(i, 1);
        break;
      case 1:
        lines.splice(i, 0, lines[i] ?? "");
        break;
      case 2: {
        const j = rand.int(lines.length);
        [lines[i], lines[j]] = [lines[j], lines[i]];
        break;
      }
      case 3: // Feld ersetzen
        if (lines[i]) {
          const f = lines[i].split("\t");
          f[rand.int(f.length)] = rand.pick(JUNK);
          lines[i] = f.join("\t");
        }
        break;
      case 4: // Typ ändern
        if (lines[i]) lines[i] = rand.pick(["d", "f", "l", "x", "D", ""]) + lines[i].slice(1);
        break;
      case 5: // Pfad: bösartige Pfade
        lines.splice(i, 0, `f\t-\t3\t${hex(128)}\t${rand.pick(["a/../b", "./a", "a//b", "/abs", "a/", "a\\b", "a\u0001b", "a\u007fb", "a�b", "x".repeat(1025), Array(49).fill("d").join("/"), Array(50).fill("d").join("/"), "SOS-TREE", "SOS-SEAL", "é/ü", "ü", ".", "..", "…"])}`);
        break;
      case 6: // Symlink mit seltsamem Ziel
        lines.splice(i, 0, `l\t-\t0\t${rand.pick(["../x", "/etc", "a/../b", "./a", "a//b", "..", "", "../..", "x/..", "a\\b", "ok/target", "version.json", "node_modules/pkg", "docs/admin/updates.md/x"])}\tlink${rand.int(5)}`);
        break;
      case 7: // Größe / Hash
        if (lines[i]) {
          const f = lines[i].split("\t");
          if (f.length === 5) {
            f[2] = rand.pick(["0", "1", "10000000000000", "1099511627776", "1099511627777", "00", "-1", "9999999999999", "12345678901234"]);
            if (rand.chance(0.5)) f[3] = rand.pick([hex(128), hex(127), hex(129), hex(128).toUpperCase(), "-", ""]);
          }
          lines[i] = f.join("\t");
        }
        break;
      case 8: // Ausführbit
        if (lines[i]) {
          const f = lines[i].split("\t");
          f[1] = rand.pick(["x", "-", "X", "", "xx"]);
          lines[i] = f.join("\t");
        }
        break;
      case 9: // Byte im Text ändern
        if (lines[i]) {
          const k = rand.int(lines[i].length);
          lines[i] = lines[i].slice(0, k) + rand.pick(["\t", "\r", "\u0000", " ", "é", "�"]) + lines[i].slice(k + 1);
        }
        break;
      case 10: // Kopf ändern
        header[rand.int(2)] = rand.pick(["schrauberos-tree 2", "hash sha256", "", "schrauberos-tree 1 ", "hash  sha512"]);
        break;
      case 11: // neuer Ordner / Datei mit gültigem Pfad
        lines.splice(i, 0, rand.pick([`d\t-\t0\t-\tzz${rand.int(9)}`, `f\t-\t0\t${hex(128)}\tzz${rand.int(9)}`, `f\tx\t0\t${hex(128)}\tzz${rand.int(9)}/q`, `d\tx\t0\t-\tzz${rand.int(9)}`, `d\t-\t1\t-\tzz${rand.int(9)}`, `d\t-\t0\tx\tzz${rand.int(9)}`]));
        break;
      case 12: // letzte Zeile ohne Zeilenende / mit Leerzeile
        lines.push(rand.pick(["", "f"]));
        break;
      default: // Zeilenenden
        if (lines[i]) lines[i] += "\r";
    }
  }
  const joined = [...header, ...lines].join("\n") + (rand.chance(0.93) ? "\n" : "");
  return Buffer.from(joined, "utf8");
}

/** Siegel zur Liste: bei lesbarer Liste mit deren Zahlen, sonst mit erfundenen (der Fehler liegt dann in der Liste). */
function sealForTree(tree, fallbackEntries = 1) {
  let fields;
  try {
    fields = sealFieldsFor(tree, { version: "0.3.0", base: 4, arch: "x64" });
  } catch {
    fields = { version: "0.3.0", base: 4, arch: "x64", treeSha512: createHash("sha512").update(tree).digest("hex"), treeSize: tree.length, treeEntries: fallbackEntries, treeBytes: 0 };
  }
  return createSeal(fields, TEST_RELEASE.privatePem, { builtInKeyPem: TEST_RELEASE.publicPem });
}

export async function parserStage(log) {
  const count = Number(process.env.PARSER_COUNT ?? 1500);
  const valid = corpus.cases.find((c) => c.name === "valid");
  const binary = buildStarter(valid.args.floor);
  const dataDir = tempDir("so-parser-");
  materializeCorpusCase(valid, dataDir);
  const versionDir = join(dataDir, "app", "versions", valid.args.version);
  const sealPath = join(versionDir, "SOS-SEAL");
  const treePath = join(versionDir, "SOS-TREE");
  const originalSeal = readFileSync(sealPath);
  const originalTree = readFileSync(treePath);
  const problems = [];
  const outcome = new Map();
  let accepted = 0;
  const judge = async (label) => {
    const both = await judgeBoth(binary, valid, dataDir);
    let diff = disagreement(both);
    // Mehrere Fremdeinträge im selben Ordner: welcher zuerst gemeldet wird, hängt von der Reihenfolge der Auflistung ab (Referenz: sortiert, C: wie das Dateisystem sie liefert)
    if (diff && both.c.code === 15 && both.ref.code === 15 && both.c.json?.reason === both.ref.reason) diff = null;
    // Mehrere Fehler in der Liste: der Referenzparser liest erst alle Zeilen (Format) und prüft danach die Zusammenhänge, C prüft Zeile für Zeile – gleiche Ablehnung, aber der zuerst gemeldete Pfad kann abweichen
    if (diff && both.c.code === 13 && both.ref.code === 13 && both.c.json?.reason === both.ref.reason && both.ref.reason === "tree-format") diff = null;
    const key = `${both.c.code}${both.c.json?.reason ? ":" + both.c.json.reason : ""}`;
    outcome.set(key, (outcome.get(key) ?? 0) + 1);
    if (both.c.code === 0) accepted++;
    if (diff) problems.push(`${label}: ${diff}`);
  };
  try {
    // A) Rumpf des Siegels
    const rand = prng("parser/seal");
    const bodyText = originalSeal.toString("latin1").split("signing-key ")[0];
    for (let i = 0; i < count; i++) {
      const body = mutateBody(rand, bodyText);
      writeFileSync(sealPath, signedSealWithBody(body));
      await judge(`Rumpf #${i} ${JSON.stringify(body.slice(0, 160))}`);
    }
    writeFileSync(sealPath, originalSeal);
    log(`  Siegel-Rümpfe: ${count} gültig signierte Mutationen`);

    // B) Dateiliste
    const randTree = prng("parser/tree");
    const treeText = originalTree.toString("utf8");
    let parsedOk = 0;
    for (let i = 0; i < count; i++) {
      const tree = mutateTree(randTree, treeText);
      try {
        parseTree(tree);
        parsedOk++;
      } catch {
        /* Fehlerfall: erfundene Zahlen im Siegel */
      }
      writeFileSync(treePath, tree);
      writeFileSync(sealPath, sealForTree(tree));
      await judge(`Liste #${i} ${JSON.stringify(tree.toString("latin1").slice(32, 200))}`);
    }
    log(`  Listen: ${count} Mutationen, davon ${parsedOk} vom Referenzparser angenommen`);
    // Kontrolle: Die Mutatoren erzeugen auch Listen, die der Parser annimmt (sonst prüft der Test nur die Ablehnung)
    if (parsedOk < count / 50) problems.push(`Zu wenige annehmbare Listen (${parsedOk}): der Test prüft die Annahme zu selten`);
    writeFileSync(treePath, originalTree);
    writeFileSync(sealPath, originalSeal);
  } finally {
    removeTree(dataDir);
  }
  log(`  Urteile von C: ${[...outcome].sort().map(([k, n]) => `${k}×${n}`).join(", ")}; ${accepted}× angenommen`);
  if (problems.length) log(problems.slice(0, 30).join("\n") + (problems.length > 30 ? `\n  … und ${problems.length - 30} weitere` : ""));
  return problems.length === 0;
}
