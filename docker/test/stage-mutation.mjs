// Stufe „mutation“: Mutationstest des C-Prüfers auf echten Verzeichnissen (wie anchor-corpus.test.ts für den Referenzprüfer, aber über Prozessgrenzen):
//  - jede einzelne Bitänderung und jede Kürzung des Siegels, ein Raster über die Liste, jede Datei einzeln verändert/verlängert/gekürzt, jeder Eintrag einzeln entfernt, ersetzt,
//    mit Setuid/Sticky versehen oder um einen Fremdeintrag ergänzt (in jedem Ordner) – nie darf der Prüfer „ok“ sagen, und er urteilt wie der Referenzprüfer (Code, Grund, Pfad).
import { chmodSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { materializeCorpusCase } from "../../src/lib/updates/testdata/anchor/corpus-fs.ts";
import { buildStarter, removeTree, run, tempDir } from "./lib.mjs";
import { corpus, disagreement, judgeBoth } from "./stage-corpus.mjs";

export async function mutationStage(log) {
  const valid = corpus.cases.find((c) => c.name === "valid");
  const binary = buildStarter(valid.args.floor);
  const dataDir = tempDir("so-mutation-");
  materializeCorpusCase(valid, dataDir);
  const versionDir = join(dataDir, "app", "versions", valid.args.version);
  const problems = [];
  let runs = 0;
  const codes = new Map();
  const judge = async (label, { allowOk = false } = {}) => {
    runs++;
    const both = await judgeBoth(binary, valid, dataDir);
    const diff = disagreement(both);
    codes.set(both.c.code, (codes.get(both.c.code) ?? 0) + 1);
    if (diff) problems.push(`${label}: ${diff}`);
    else if (!allowOk && both.c.code === 0) problems.push(`${label}: wurde akzeptiert`);
    return both;
  };

  try {
    // Ausgangslage
    const base = await judge("Ausgang", { allowOk: true });
    if (base.c.code !== 0) throw new Error(`Das gültige Paket besteht nicht: ${JSON.stringify(base.c.json)}`);

    // ───── Siegel: jede Bitänderung, jede Kürzung ─────
    const sealPath = join(versionDir, "SOS-SEAL");
    const seal = readFileSync(sealPath);
    for (let i = 0; i < seal.length; i++) {
      for (let bit = 0; bit < 8; bit++) {
        const copy = Buffer.from(seal);
        copy[i] ^= 1 << bit;
        writeFileSync(sealPath, copy);
        await judge(`Siegel Byte ${i} Bit ${bit}`);
      }
    }
    for (let length = 0; length < seal.length; length++) {
      writeFileSync(sealPath, seal.subarray(0, length));
      await judge(`Siegel gekürzt auf ${length}`);
    }
    writeFileSync(sealPath, Buffer.concat([seal, Buffer.from("x")]));
    await judge("Siegel verlängert");
    writeFileSync(sealPath, seal);
    log(`  Siegel: ${seal.length} Bytes × 8 Bitänderungen + ${seal.length} Kürzungen + 1 Verlängerung geprüft`);

    // ───── Liste: Raster über die Datei ─────
    const treePath = join(versionDir, "SOS-TREE");
    const tree = readFileSync(treePath);
    const step = Math.max(1, Math.floor(tree.length / 500));
    for (let i = 0; i < tree.length; i += step) {
      const copy = Buffer.from(tree);
      copy[i] ^= 1 << (i % 8);
      writeFileSync(treePath, copy);
      await judge(`Liste Byte ${i}`);
    }
    for (const length of [0, 1, 31, 32, 33, tree.length - 1]) {
      writeFileSync(treePath, tree.subarray(0, length));
      await judge(`Liste gekürzt auf ${length}`);
    }
    writeFileSync(treePath, tree);
    log(`  Liste: ${Math.ceil(tree.length / step)} Bitänderungen (Raster ${step}) + 6 Kürzungen geprüft`);

    // ───── Baum: Einträge einzeln verändern ─────
    const entries = valid.entries.filter((e) => e.path.startsWith(`app/versions/${valid.args.version}/`)).map((e) => ({ ...e, rel: e.path.slice(`app/versions/${valid.args.version}/`.length) }));
    const dirs = entries.filter((e) => e.type === "d");
    const abs = (rel) => join(versionDir, ...rel.split("/"));
    for (const e of entries) {
      const file = abs(e.rel);
      if (e.type === "f") {
        const original = readFileSync(file);
        const mode = lstatSync(file).mode & 0o7777;
        if (original.length > 0) {
          for (const at of new Set([0, original.length - 1])) {
            const copy = Buffer.from(original);
            copy[at] ^= 0x01;
            writeFileSync(file, copy);
            await judge(`Datei ${e.rel}: Byte ${at} geändert`);
          }
          writeFileSync(file, original.subarray(0, original.length - 1));
          await judge(`Datei ${e.rel}: gekürzt`);
        }
        writeFileSync(file, Buffer.concat([original, Buffer.from("x")]));
        await judge(`Datei ${e.rel}: verlängert`);
        writeFileSync(file, original);
        chmodSync(file, mode);
        chmodSync(file, mode | 0o4000);
        await judge(`Datei ${e.rel}: Setuid`);
        chmodSync(file, mode | 0o2000);
        await judge(`Datei ${e.rel}: Setgid`);
        chmodSync(file, mode | 0o1000);
        await judge(`Datei ${e.rel}: Sticky`);
        if ((mode & 0o111) !== 0) {
          chmodSync(file, mode & ~0o111);
          await judge(`Datei ${e.rel}: Ausführbit entzogen`);
        }
        chmodSync(file, mode);
        // Typ tauschen
        rmSync(file);
        mkdirSync(file);
        await judge(`Datei ${e.rel}: durch Ordner ersetzt`);
        rmSync(file, { recursive: true });
        symlinkSync("version.json", file);
        await judge(`Datei ${e.rel}: durch Symlink ersetzt`);
        rmSync(file);
        run("mkfifo", [file]);
        await judge(`Datei ${e.rel}: durch FIFO ersetzt`);
        rmSync(file);
        writeFileSync(file, original);
        chmodSync(file, mode);
        // entfernen
        const moved = `${file}.weg`;
        renameSync(file, moved);
        await judge(`Datei ${e.rel}: fehlt`);
        rmSync(moved);
        writeFileSync(file, original);
        chmodSync(file, mode);
      } else if (e.type === "l") {
        const target = readlinkSync(file);
        rmSync(file);
        symlinkSync("anderes-ziel", file);
        await judge(`Link ${e.rel}: anderes Ziel`);
        rmSync(file);
        writeFileSync(file, "x");
        await judge(`Link ${e.rel}: durch Datei ersetzt`);
        rmSync(file);
        await judge(`Link ${e.rel}: fehlt`);
        symlinkSync(target, file);
      }
    }
    for (const d of dirs) {
      const dir = abs(d.rel);
      const mode = lstatSync(dir).mode & 0o7777;
      for (const extra of ["fremd.txt", ".versteckt"]) {
        writeFileSync(join(dir, extra), "x");
        await judge(`Ordner ${d.rel}: zusätzliche Datei ${extra}`);
        rmSync(join(dir, extra));
      }
      mkdirSync(join(dir, "fremd-leer"));
      await judge(`Ordner ${d.rel}: zusätzlicher leerer Ordner`);
      rmSync(join(dir, "fremd-leer"), { recursive: true });
      symlinkSync("version.json", join(dir, "fremd-link"));
      await judge(`Ordner ${d.rel}: zusätzlicher Symlink`);
      rmSync(join(dir, "fremd-link"));
      run("mkfifo", [join(dir, "fremd-fifo")]);
      await judge(`Ordner ${d.rel}: zusätzliche FIFO`);
      rmSync(join(dir, "fremd-fifo"));
      for (const bits of [0o2000, 0o1000]) {
        chmodSync(dir, mode | bits);
        await judge(`Ordner ${d.rel}: Setgid/Sticky ${bits.toString(8)}`);
        chmodSync(dir, mode);
      }
    }
    // Wurzel
    for (const extra of ["fremd.txt", ".versteckt"]) {
      writeFileSync(join(versionDir, extra), "x");
      await judge(`Wurzel: zusätzliche Datei ${extra}`);
      rmSync(join(versionDir, extra));
    }
    for (const forbidden of ["node_modules"]) {
      for (const parent of [dirname(versionDir), join(dataDir, "app"), dataDir]) {
        mkdirSync(join(parent, forbidden));
        await judge(`${forbidden} in ${parent === dataDir ? "DATA_DIR" : parent.endsWith("app") ? "app" : "versions"}`);
        rmSync(join(parent, forbidden), { recursive: true });
      }
    }
    // Nach allem: unverändert gültig (das Paket wurde jedes Mal sauber zurückgestellt)
    const after = await judge("Nachprobe", { allowOk: true });
    if (after.c.code !== 0) problems.push(`Nachprobe: das Paket besteht nicht mehr (${JSON.stringify(after.c.json)})`);
  } finally {
    removeTree(dataDir);
  }
  log(`${runs} Prüfungen; Exit-Codes: ${[...codes].sort((a, b) => a[0] - b[0]).map(([code, n]) => `${code}×${n}`).join(", ")}`);
  if (problems.length) log(problems.slice(0, 40).join("\n") + (problems.length > 40 ? `\n  … und ${problems.length - 40} weitere` : ""));
  return problems.length === 0;
}

