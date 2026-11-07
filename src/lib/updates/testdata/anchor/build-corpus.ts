/**
 * Goldkorpus des Starter-Vertrauensankers: eingecheckte Verzeichnisbäume samt Siegel und Liste mit **von Hand festgelegtem** erwartetem Urteil
 * (`cases.json`, erzeugt von `scripts/gen-anchor-corpus.mjs`). Er entkoppelt die beiden Prüfer zeitlich: Der TypeScript-Referenzprüfer (`seal.ts`) besteht ihn
 * heute (`anchor-corpus.test.ts`), der C-Prüfer im Starter wird in Teil 2 gegen dieselbe Datei entwickelt (`docker/test/run.mjs` legt die Fälle mit
 * `materializeCorpusCase` als echte Verzeichnisse an – Ausführbit, Setuid, Symlinks, FIFOs – und vergleicht Exit-Code und Pfad).
 *
 * Alle Pfade der Einträge sind relativ zum **Datenverzeichnis** (`DATA_DIR`): Die Version liegt unter `app/versions/<version>/`, so lässt sich auch die
 * Vorfahrenregel (`node_modules` darüber) abbilden. Schlüssel: nur Testschlüssel (`test-keys.ts`), ohne Wert.
 */
import { createHash, sign } from "node:crypto";
import { createEndorsement } from "../../keychain.ts";
import { createSeal, SEAL_CONTEXT, sealFieldsFor, type SealFields } from "../../seal.ts";
import { generateTree, serializeTree, sha512Hex, TREE_FILE, SEAL_FILE, TREE_HEADER } from "../../tree.ts";
import { MemoryFs } from "../../tree-testkit.ts";
import { TEST_OTHER_ROOT, TEST_RELEASE, TEST_ROGUE, TEST_ROOT, TEST_SECOND, type TestKey } from "./test-keys.ts";

export type CorpusEntry = { path: string; type: "f" | "d" | "l" | "o"; mode: number; b64?: string; target?: string };
export type CorpusArgs = {
  /** Name des Versionsordners = `--expect-version` */
  version: string;
  image: { base: number; arch: string };
  floor?: string;
  enforceFloor?: boolean;
  /** `--check-expiry` (JJJJ-MM-TT) */
  checkExpiry?: string;
};
export type CorpusExpect = { code: number; class: "ok" | "negative" | "benign" | "inconclusive"; reason?: string; path?: string };
export type CorpusCase = { name: string; description: string; args: CorpusArgs; entries: CorpusEntry[]; expect: CorpusExpect };
export type Corpus = {
  format: "sos-anchor-corpus 1";
  testOnly: true;
  /** Vertrauensanker des Testbinaries (nur Testschlüssel) */
  trust: { rootPublicPem: string; rootPublicHex: string; releasePublicPem: string; releasePublicHex: string };
  cases: CorpusCase[];
};

const VERSION = "0.3.0";
const IMAGE = { base: 4, arch: "x64" };
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

/** Das Grundpaket (Pfade relativ zum Versionsordner): von allem etwas, was ein echtes Paket hat. */
function basePackage(version: string): MemoryFs {
  const fs = new MemoryFs();
  fs.file("version.json", JSON.stringify({ version, base: 4, arch: "x64" }) + "\n");
  fs.file("server.js", "// server\n");
  fs.file("launcher.mjs", "// launcher\n");
  fs.dir("runtime").dir("runtime/lib");
  fs.file("runtime/node", Buffer.from("\x7fELF node", "latin1"), 0o755);
  fs.file("runtime/loader", "lib/ld-linux-x86-64.so.2\n");
  fs.file("runtime/lib/ld-linux-x86-64.so.2", Buffer.from("\x7fELF ld", "latin1"), 0o755);
  fs.file("runtime/lib/libc.so.6", "libc");
  fs.dir(".next").dir(".next/static").dir(".next/static/chunks").dir(".next/node_modules");
  fs.file(".next/static/chunks/a.js", "console.log(1);\n");
  fs.file(".next/BUILD_ID", "abc123");
  fs.link(".next/node_modules/pkg-abc", "../../node_modules/pkg");
  fs.dir("node_modules").dir("node_modules/pkg");
  fs.file("node_modules/pkg/index.js", "module.exports = 1;\n");
  fs.file("node_modules/pkg/empty.txt", "");
  fs.dir("prisma").dir("prisma/migrations").dir("prisma/migrations/00000000000000_baseline");
  fs.file("prisma/migrations/00000000000000_baseline/migration.sql", "-- schrauberos:baseline frozen\n");
  fs.dir("public").dir("public/icons");
  fs.file("public/icons/192.png", PNG);
  fs.dir("docs").dir("docs/admin");
  fs.file("docs/admin/updates.md", "# Updates\n");
  fs.dir("tmp-leer");
  fs.file("Ünïcode-Datei äöü.txt", "utf-8 names are fine\n");
  return fs;
}

type Signed = { fs: MemoryFs; fields: SealFields };

/** Siegel und Liste für den Baum erzeugen und ablegen (so, wie es die Pipeline tut). */
async function seal(fs: MemoryFs, options: { version?: string; base?: number; arch?: string; signer?: TestKey; endorsementUntil?: string; endorsedBy?: TestKey } = {}): Promise<Signed> {
  const tree = serializeTree(await generateTree(fs));
  fs.file(TREE_FILE, tree);
  const fields = sealFieldsFor(tree, { version: options.version ?? VERSION, base: options.base ?? 4, arch: options.arch ?? "x64" });
  const signer = options.signer ?? TEST_RELEASE;
  const endorsement = signer === TEST_RELEASE ? undefined : createEndorsement((options.endorsedBy ?? TEST_ROOT).privatePem, signer.publicPem, options.endorsementUntil ?? "2099-12-31");
  fs.file(SEAL_FILE, createSeal(fields, signer.privatePem, { builtInKeyPem: TEST_RELEASE.publicPem, endorsement }));
  return { fs, fields };
}

/** Wie `seal`, aber mit beliebigen Listen-Bytes (für fehlerhafte Listen, die dennoch **gültig signiert** sind). */
function sealRawTree(fs: MemoryFs, tree: Buffer, entriesCount: number): void {
  fs.file(TREE_FILE, tree);
  const fields: SealFields = { version: VERSION, base: 4, arch: "x64", treeSha512: sha512Hex(tree), treeSize: tree.length, treeEntries: entriesCount, treeBytes: 0 };
  fs.file(SEAL_FILE, createSeal(fields, TEST_RELEASE.privatePem, { builtInKeyPem: TEST_RELEASE.publicPem }));
}

/** Ein Siegel mit beliebigem Rumpf, gültig signiert (Form A) – für formal fehlerhafte Rümpfe. */
function signedSealWithBody(body: string): Buffer {
  const part = Buffer.from(`${body}signing-key ${TEST_RELEASE.publicHex}\n`);
  const signature = sign(null, Buffer.concat([Buffer.from(SEAL_CONTEXT), part]), TEST_RELEASE.privatePem);
  return Buffer.concat([part, Buffer.from(`signature ${signature.toString("hex")}\n`)]);
}

function toEntries(fs: MemoryFs, version: string, extra: CorpusEntry[] = []): CorpusEntry[] {
  const prefix = `app/versions/${version}`;
  const out: CorpusEntry[] = [
    { path: "app", type: "d", mode: 0o755 },
    { path: "app/versions", type: "d", mode: 0o755 },
    { path: prefix, type: "d", mode: 0o755 },
    ...extra,
  ];
  for (const [path, node] of fs.nodes) {
    if (node.kind === "file") out.push({ path: `${prefix}/${path}`, type: "f", mode: node.mode, b64: node.content.toString("base64") });
    else if (node.kind === "dir") out.push({ path: `${prefix}/${path}`, type: "d", mode: node.mode });
    else if (node.kind === "symlink") out.push({ path: `${prefix}/${path}`, type: "l", mode: 0o777, target: node.target });
    else out.push({ path: `${prefix}/${path}`, type: "o", mode: node.mode });
  }
  return out.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
}

const OK: CorpusExpect = { code: 0, class: "ok" };
const neg = (code: number, reason?: string, path?: string): CorpusExpect => ({ code, class: "negative", ...(reason ? { reason } : {}), ...(path ? { path } : {}) });
const benign = (reason: string): CorpusExpect => ({ code: 19, class: "benign", reason });

/** Zweistellige Kennung des Hashes eines geänderten Inhalts gleicher Länge. */
const sameLength = (original: Buffer) => Buffer.from(Buffer.from(original).map((b) => (b === 0x41 ? 0x42 : 0x41)));

export async function buildCorpus(): Promise<Corpus> {
  const cases: CorpusCase[] = [];
  const baseArgs = (overrides: Partial<CorpusArgs> = {}): CorpusArgs => ({ version: VERSION, image: IMAGE, floor: "0.2.0-dev.abc1234", ...overrides });
  const add = (name: string, description: string, fs: MemoryFs, expect: CorpusExpect, args: Partial<CorpusArgs> = {}, extra: CorpusEntry[] = []) => {
    const version = args.version ?? VERSION;
    cases.push({ name, description, args: baseArgs(args), entries: toEntries(fs, version, extra), expect });
  };
  const fresh = async (options: Parameters<typeof seal>[1] = {}) => (await seal(basePackage(options.version ?? VERSION), options)).fs;

  // ───── gültige Pakete ─────
  add("valid", "Gültiges Paket, mit dem eingebauten Release-Schlüssel signiert (Siegel Form A).", await fresh(), OK);
  add("valid-endorsed", "Gültig: signiert mit einem vom Wurzelschlüssel beglaubigten Schlüssel (Siegel Form B).", await fresh({ signer: TEST_SECOND }), OK);
  {
    const fs = await fresh();
    fs.nodes.set("server.js", { kind: "file", content: Buffer.from("// server\n"), mode: 0o755 }); // zusätzliches x-Bit an einer mit „-“ markierten Datei
    add("valid-extra-exec-bit", "Eine nicht als ausführbar markierte Datei trägt ein Ausführbit: gleichgültig (Bind-Mounts mit festen Modi, Sec F10).", fs, OK);
  }
  add("valid-floor-prerelease", "Untergrenze ist eine Vorabversion derselben Zahlen (0.3.0-dev.x): die Veröffentlichung 0.3.0 liegt darüber.", await fresh(), OK, { floor: "0.3.0-dev.abc1234" });
  add("valid-floor-not-enforced", "Untergrenze nur melden, nicht erzwingen (--verify der Echtprobe, Arch F3).", await fresh(), OK, { floor: "0.4.0", enforceFloor: false });
  add("valid-endorsement-expired-not-checked", "Abgelaufene Beglaubigung, aber ohne --check-expiry: der Starter prüft den Ablauf nicht (E5).", await fresh({ signer: TEST_SECOND, endorsementUntil: "2026-01-31" }), OK);

  // ───── Abweichungen im Baum ─────
  {
    const fs = await fresh();
    fs.file("extra.txt", "zusätzlich");
    add("extra-file", "Zusätzliche Datei im Wurzelordner.", fs, neg(15, "extra", "extra.txt"));
  }
  {
    const fs = await fresh();
    fs.dir(".cache").file(".cache/x", "versteckt");
    add("extra-hidden-dir", "Zusätzlicher versteckter Ordner samt Datei (kein Ignorierbereich).", fs, neg(15, "extra"));
  }
  {
    const fs = await fresh();
    fs.dir("leer-zusaetzlich");
    add("extra-empty-dir", "Zusätzlicher leerer Ordner.", fs, neg(15, "extra", "leer-zusaetzlich"));
  }
  {
    const fs = await fresh();
    fs.file("node_modules/pkg/evil.js", "x");
    add("extra-in-node-modules", "Zusätzliche Datei in node_modules.", fs, neg(15, "extra", "node_modules/pkg/evil.js"));
  }
  {
    const fs = await fresh();
    fs.file(".next/static/chunks/backdoor.js", "x");
    add("extra-in-next-static", "Zusätzliche Datei in .next/static (würde an Browser ausgeliefert).", fs, neg(15, "extra", ".next/static/chunks/backdoor.js"));
  }
  {
    const fs = await fresh();
    fs.link("neuer-link", "server.js");
    add("extra-symlink", "Zusätzlicher Symlink.", fs, neg(15, "extra", "neuer-link"));
  }
  {
    const fs = await fresh();
    fs.other("fifo");
    add("extra-fifo", "Zusätzliche FIFO (Sonderdatei).", fs, neg(15, "extra", "fifo"));
  }
  {
    const fs = await fresh();
    fs.file("a\tb\nc", "x");
    add("extra-file-control-chars", "Zusätzliche Datei mit TAB und Zeilenumbruch im Namen (darf Listen und Logs nicht verwirren).", fs, neg(15, "extra"));
  }
  {
    const fs = await fresh();
    fs.file("x".repeat(250), "lang"); // NAME_MAX ist 255: längere Namen lassen sich unter Linux nicht anlegen
    add("extra-file-long-name", "Zusätzliche Datei mit sehr langem Namen (250 Zeichen, nahe an NAME_MAX).", fs, neg(15, "extra"));
  }
  {
    const fs = await fresh();
    fs.remove("server.js");
    add("missing-file", "Datei fehlt.", fs, neg(14, "missing", "server.js"));
  }
  {
    const fs = await fresh();
    fs.remove("tmp-leer");
    add("missing-empty-dir", "Leerer Ordner fehlt.", fs, neg(14, "missing", "tmp-leer"));
  }
  {
    const fs = await fresh();
    fs.remove("node_modules/pkg");
    add("missing-dir", "Ganzer Ordner samt Inhalt fehlt.", fs, neg(14, "missing"));
  }
  {
    const fs = await fresh();
    fs.file("node_modules/pkg/index.js", sameLength(Buffer.from("module.exports = 1;\n")));
    add("wrong-hash", "Inhalt gleicher Länge verändert.", fs, neg(16, "hash", "node_modules/pkg/index.js"));
  }
  {
    const fs = await fresh();
    fs.file("server.js", "// server (länger)\n");
    add("wrong-size", "Datei länger geworden.", fs, neg(16, "size", "server.js"));
  }
  {
    const fs = await fresh();
    fs.file("node_modules/pkg/empty.txt", "x");
    add("empty-file-grew", "Leere Datei hat Inhalt bekommen.", fs, neg(16, "size", "node_modules/pkg/empty.txt"));
  }
  {
    const fs = await fresh();
    fs.link(".next/node_modules/pkg-abc", "../../node_modules/anders");
    add("symlink-target-changed", "Symlink zeigt auf ein anderes Ziel.", fs, neg(16, "target", ".next/node_modules/pkg-abc"));
  }
  {
    const fs = await fresh();
    fs.remove(".next/node_modules/pkg-abc").file(".next/node_modules/pkg-abc", "kein Link mehr");
    add("symlink-replaced-by-file", "Symlink durch eine Datei ersetzt.", fs, neg(16, "type", ".next/node_modules/pkg-abc"));
  }
  {
    const fs = await fresh();
    fs.remove("docs/admin").file("docs/admin", "Datei statt Ordner");
    add("dir-replaced-by-file", "Ordner durch eine Datei ersetzt.", fs, neg(16, "type", "docs/admin"));
  }
  {
    const fs = await fresh();
    fs.remove("server.js").dir("server.js");
    add("file-replaced-by-dir", "Datei durch einen Ordner ersetzt.", fs, neg(16, "type", "server.js"));
  }
  {
    const fs = await fresh();
    fs.remove("server.js").other("server.js");
    add("file-replaced-by-fifo", "Datei durch eine FIFO ersetzt (der Prüfer darf nicht daran hängen bleiben).", fs, neg(16, "type", "server.js"));
  }
  {
    const fs = await fresh();
    fs.nodes.set("runtime/node", { kind: "file", content: Buffer.from("\x7fELF node", "latin1"), mode: 0o644 });
    add("exec-bit-lost", "Als ausführbar eingetragene Datei hat kein Ausführbit mehr.", fs, neg(16, "exec", "runtime/node"));
  }
  {
    const fs = await fresh();
    fs.nodes.set("runtime/node", { kind: "file", content: Buffer.from("\x7fELF node", "latin1"), mode: 0o4755 });
    add("setuid-file", "Setuid-Bit an einer Datei.", fs, neg(16, "setid", "runtime/node"));
  }
  {
    const fs = await fresh();
    fs.nodes.set("docs", { kind: "dir", mode: 0o2755 });
    add("setgid-dir", "Setgid-Bit an einem Ordner.", fs, neg(16, "setid", "docs"));
  }
  {
    const fs = await fresh();
    fs.nodes.set("public", { kind: "dir", mode: 0o1777 });
    add("sticky-dir", "Sticky-Bit an einem Ordner.", fs, neg(16, "setid", "public"));
  }

  {
    const fs = await fresh();
    const seal = fs.nodes.get(SEAL_FILE) as { content: Buffer };
    fs.nodes.set(SEAL_FILE, { kind: "file", content: seal.content, mode: 0o4644 });
    add("setuid-seal", "Setuid-Bit am Siegel (steht nicht in der Liste, ist aber ebenso verboten).", fs, neg(16, "setid", SEAL_FILE));
  }
  {
    const fs = await fresh();
    const list = fs.nodes.get(TREE_FILE) as { content: Buffer };
    fs.nodes.set(TREE_FILE, { kind: "file", content: list.content, mode: 0o2644 });
    add("setgid-tree", "Setgid-Bit an der Dateiliste.", fs, neg(16, "setid", TREE_FILE));
  }
  {
    add("sticky-root", "Sticky-Bit am Versionsordner selbst.", await fresh(), neg(16, "setid", ""), {}, []);
    const c = cases[cases.length - 1];
    c.entries.find((e) => e.path === `app/versions/${VERSION}`)!.mode = 0o1755;
  }

  // ───── Siegel ─────
  {
    const fs = await fresh();
    const bytes = Buffer.from((fs.nodes.get(SEAL_FILE) as { content: Buffer }).content);
    const at = bytes.length - 20; // eine Hexziffer der Signatur (nie die letzte, das Zeilenende)
    bytes[at] = bytes[at] === 0x30 ? 0x31 : 0x30;
    fs.file(SEAL_FILE, bytes);
    add("seal-bad-signature", "Eine Hexziffer der Signatur geändert.", fs, neg(11, "bad-signature"));
  }
  {
    const fs = await fresh();
    const bytes = Buffer.from((fs.nodes.get(SEAL_FILE) as { content: Buffer }).content);
    const at = bytes.indexOf("tree-entries ");
    bytes[at + "tree-entries ".length] = bytes[at + "tree-entries ".length] === 0x39 ? 0x31 : bytes[at + "tree-entries ".length] + 1;
    fs.file(SEAL_FILE, bytes);
    add("seal-body-edited", "Zahl im Rumpf des Siegels geändert, Signatur unverändert.", fs, neg(11, "bad-signature"));
  }
  add("seal-wrong-key", "Gültig signiert, aber mit einem nicht vertrauten Schlüssel ohne Beglaubigung (Form A mit fremdem signing-key).", await (async () => {
    const fs = await fresh();
    const tree = (fs.nodes.get(TREE_FILE) as { content: Buffer }).content;
    const fields = sealFieldsFor(tree, { version: VERSION, base: 4, arch: "x64" });
    const part = Buffer.from(`${bodyText(fields)}signing-key ${TEST_ROGUE.publicHex}\n`);
    const signature = sign(null, Buffer.concat([Buffer.from(SEAL_CONTEXT), part]), TEST_ROGUE.privatePem);
    fs.file(SEAL_FILE, Buffer.concat([part, Buffer.from(`signature ${signature.toString("hex")}\n`)]));
    return fs;
  })(), neg(11, "unknown-key"));
  add("seal-endorsed-by-other-root", "Schlüssel von einem fremden Wurzelschlüssel beglaubigt.", await fresh({ signer: TEST_SECOND, endorsedBy: TEST_OTHER_ROOT }), neg(11, "endorsement-invalid"));
  add("seal-endorsement-expired", "Beglaubigung abgelaufen, geprüft mit --check-expiry 2026-11-07.", await fresh({ signer: TEST_SECOND, endorsementUntil: "2026-01-31" }), neg(11, "endorsement-expired"), { checkExpiry: "2026-11-07" });
  add("seal-endorsement-valid-checked", "Beglaubigung gültig bis 2099, geprüft mit --check-expiry 2026-11-07.", await fresh({ signer: TEST_SECOND }), OK, { checkExpiry: "2026-11-07" });
  {
    const fs = await fresh();
    fs.nodes.delete(SEAL_FILE);
    add("seal-missing", "Siegel fehlt.", fs, neg(10, "seal-missing"));
  }
  {
    const fs = await fresh();
    fs.file(SEAL_FILE, "das ist kein Siegel\n");
    add("seal-garbage", "Siegel ist kein Siegel.", fs, neg(10));
  }
  {
    const fs = await fresh();
    const bytes = (fs.nodes.get(SEAL_FILE) as { content: Buffer }).content;
    fs.file(SEAL_FILE, bytes.subarray(0, bytes.length - 40));
    add("seal-truncated", "Siegel abgeschnitten.", fs, neg(10));
  }
  {
    const fs = await fresh();
    const bytes = (fs.nodes.get(SEAL_FILE) as { content: Buffer }).content;
    fs.file(SEAL_FILE, Buffer.concat([bytes, Buffer.from("extra\n")]));
    add("seal-trailing-garbage", "Etwas nach der signature-Zeile.", fs, neg(10));
  }
  {
    const fs = await fresh();
    fs.file(SEAL_FILE, Buffer.alloc(9000, 0x61));
    add("seal-too-large", "Siegel größer als 8 KiB.", fs, neg(10, "too-large"));
  }
  {
    const fs = await fresh();
    fs.nodes.set(SEAL_FILE, { kind: "dir", mode: 0o755 });
    add("seal-is-directory", "SOS-SEAL ist ein Ordner.", fs, neg(10, "seal-missing"));
  }
  {
    const fs = await fresh();
    fs.remove(SEAL_FILE).link(SEAL_FILE, "version.json");
    add("seal-is-symlink", "SOS-SEAL ist ein Symlink.", fs, neg(10, "seal-missing"));
  }
  {
    const fs = await fresh();
    const tree = (fs.nodes.get(TREE_FILE) as { content: Buffer }).content;
    const fields = sealFieldsFor(tree, { version: VERSION, base: 4, arch: "x64" });
    fs.file(SEAL_FILE, signedSealWithBody(bodyText({ ...fields, version: "01.3.0" })));
    add("seal-signed-but-leading-zero", "Gültig signiert, aber Version mit führender Null im Rumpf.", fs, neg(10, "body:value"));
  }

  // ───── Version, Untergrenze, Image ─────
  add("version-folder-mismatch", "Siegel einer anderen Version in den Ordner kopiert (Umetikettieren): Ordner 0.3.1, Siegel 0.3.0.", await fresh(), neg(12, "seal-version"), { version: "0.3.1" });
  add("floor-equal", "Version gleich der Untergrenze (eingebaute Version): veraltet, kein Alarm.", await fresh(), benign("floor"), { floor: "0.3.0" });
  add("floor-above", "Version unter der Untergrenze: veraltet, kein Alarm.", await fresh(), benign("floor"), { floor: "0.4.0" });
  add("floor-prerelease-above", "Untergrenze 0.4.0-dev.x liegt über 0.3.0.", await fresh(), benign("floor"), { floor: "0.4.0-dev.abc1234" });
  add("floor-lower-ok", "Untergrenze 0.2.9 liegt unter 0.3.0.", await fresh(), OK, { floor: "0.2.9" });
  add("base-mismatch", "Siegel mit base 5, Image hat base 4: unverträglich, kein Alarm.", await fresh({ base: 5 }), benign("base"));
  add("arch-mismatch", "Siegel für arm64, Image ist x64: unverträglich, kein Alarm.", await fresh({ arch: "arm64" }), benign("arch"));

  // ───── Liste ─────
  {
    const fs = await fresh();
    const tree = (fs.nodes.get(TREE_FILE) as { content: Buffer }).content;
    fs.file(TREE_FILE, Buffer.concat([tree, Buffer.from("\n")]));
    add("tree-size-changed", "SOS-TREE ist größer als im Siegel.", fs, neg(13, "tree-size"));
  }
  {
    const fs = await fresh();
    const tree = Buffer.from((fs.nodes.get(TREE_FILE) as { content: Buffer }).content);
    tree[tree.length - 3] = tree[tree.length - 3] === 0x61 ? 0x62 : 0x61;
    fs.file(TREE_FILE, tree);
    add("tree-hash-changed", "Ein Byte der Liste geändert (gleiche Größe): Hash passt nicht zum Siegel.", fs, neg(13, "tree-hash"));
  }
  {
    const fs = await fresh();
    fs.nodes.delete(TREE_FILE);
    add("tree-missing", "SOS-TREE fehlt.", fs, neg(13, "tree-missing"));
  }
  {
    const fs = await fresh();
    const tree = (fs.nodes.get(TREE_FILE) as { content: Buffer }).content;
    const fields = sealFieldsFor(tree, { version: VERSION, base: 4, arch: "x64" });
    fs.file(SEAL_FILE, createSeal({ ...fields, treeEntries: fields.treeEntries + 1 }, TEST_RELEASE.privatePem, { builtInKeyPem: TEST_RELEASE.publicPem }));
    add("tree-counts-mismatch", "Siegel nennt eine andere Eintragszahl als die Liste.", fs, neg(13, "tree-counts"));
  }
  {
    // Der Angreifer ersetzt Datei UND Liste – das Siegel (signiert den Hash der Liste) bleibt, also passt die neue Liste nicht
    const fs = await fresh();
    fs.file("server.js", "// böse\n");
    fs.file(TREE_FILE, serializeTree(await generateTree(fs)));
    add("tree-replaced", "Datei geändert und die Liste passend neu erzeugt: Hash der Liste passt nicht zum Siegel.", fs, neg(13));
  }
  const hash = "a".repeat(128);
  const f = (path: string, h = hash, x = "-") => `f\t${x}\t3\t${h}\t${path}\n`;
  const crafted: Array<[string, string, string]> = [
    ["tree-unsorted", "Einträge nicht aufsteigend sortiert.", TREE_HEADER + f("b") + f("a")],
    ["tree-duplicate", "Doppelter Eintrag.", TREE_HEADER + f("a") + f("a")],
    ["tree-tab-in-path", "TAB im Pfad (sechs Felder).", TREE_HEADER + f("a\tb")],
    ["tree-dotdot", "Pfad mit .. -Teil.", TREE_HEADER + `d\t-\t0\t-\ta\n` + f("a/../b")],
    ["tree-absolute", "Absoluter Pfad.", TREE_HEADER + f("/etc/passwd")],
    ["tree-control-char", "Steuerzeichen im Pfad.", TREE_HEADER + f("a\u0001b")],
    ["tree-long-path", "Pfad länger als 1024 Bytes.", TREE_HEADER + f("x".repeat(1025))],
    ["tree-missing-parent", "Eintrag ohne Elternordner in der Liste.", TREE_HEADER + f("a/b")],
    ["tree-uppercase-hash", "Hash in Großbuchstaben.", TREE_HEADER + f("a", "A".repeat(128))],
    ["tree-exec-on-dir", "Ausführbit an einem Ordner.", TREE_HEADER + "d\tx\t0\t-\ta\n"],
    ["tree-wrong-header", "Falsche Kopfzeile.", TREE_HEADER.replace("tree 1", "tree 2") + f("a")],
    ["tree-crlf", "Windows-Zeilenenden.", (TREE_HEADER + f("a")).replace(/\n/g, "\r\n")],
    ["tree-absolute-link", "Symlink mit absolutem Ziel.", TREE_HEADER + "l\t-\t0\t/etc/passwd\tlink\n"],
    ["tree-link-escapes", "Symlink-Ziel verlässt den Baum.", TREE_HEADER + "l\t-\t0\t../../x\tlink\n"],
    ["tree-link-dotdot-after-name", "Symlink-Ziel mit .. hinter einem Namen.", TREE_HEADER + "d\t-\t0\t-\ta\n" + "l\t-\t0\ta/../a\tlink\n"],
    ["tree-link-via-symlink", "Symlink-Ziel führt über einen weiteren Symlink.", TREE_HEADER + "d\t-\t0\t-\ta\n" + "l\t-\t0\ta\tb\n" + "l\t-\t0\tb/x\tc\n"],
  ];
  for (const [name, description, text] of crafted) {
    const fs = new MemoryFs();
    sealRawTree(fs, Buffer.from(text, "utf8"), 1);
    add(name, `${description} (gültig signiert, die Liste selbst ist fehlerhaft)`, fs, neg(13, "tree-format"));
  }

  // ───── Vorfahren ─────
  add("ancestor-node-modules-versions", "node_modules neben dem Versionsordner (app/versions/node_modules): Node würde dort Module suchen.", await fresh(), neg(18, "node_modules-in-ancestor"), {}, [{ path: "app/versions/node_modules", type: "d", mode: 0o755 }]);
  add("ancestor-node-modules-app", "node_modules in app/.", await fresh(), neg(18, "node_modules-in-ancestor"), {}, [{ path: "app/node_modules", type: "d", mode: 0o755 }]);
  add("ancestor-node-modules-data", "node_modules direkt im Datenverzeichnis.", await fresh(), neg(18, "node_modules-in-ancestor"), {}, [{ path: "node_modules", type: "d", mode: 0o755 }]);
  add("ancestor-node-modules-as-file", "node_modules als Datei/Symlink in einem Vorfahrenordner zählt ebenso.", await fresh(), neg(18, "node_modules-in-ancestor"), {}, [{ path: "app/versions/node_modules", type: "l", mode: 0o777, target: "/tmp" }]);

  const trust = { rootPublicPem: TEST_ROOT.publicPem, rootPublicHex: TEST_ROOT.publicHex, releasePublicPem: TEST_RELEASE.publicPem, releasePublicHex: TEST_RELEASE.publicHex };
  return { format: "sos-anchor-corpus 1", testOnly: true, trust, cases };
}

/** Der Rumpf eines Siegels (nur für Fälle, die ein formal falsches Siegel gültig signieren). */
function bodyText(f: SealFields): string {
  return `schrauberos-seal 1\nversion ${f.version}\nbase ${f.base}\narch ${f.arch}\ntree-sha512 ${f.treeSha512}\ntree-size ${f.treeSize}\ntree-entries ${f.treeEntries}\ntree-bytes ${f.treeBytes}\n`;
}

/**
 * Stabile Textform: ein Fall je Block, ein Eintrag je Zeile (lesbare Diffs, kleine Datei) – dieselbe Eingabe ergibt dieselben Bytes.
 * Die Datei ist `-text` (.gitattributes): Prüfsummen und Hashes der Fälle dürfen nie durch Zeilenenden-Umwandlung brechen.
 */
export function corpusToJson(corpus: Corpus): string {
  const { cases, ...head } = corpus;
  const block = (c: CorpusCase) => {
    const { entries, ...rest } = c;
    return `${JSON.stringify(rest).slice(0, -1)},"entries":[\n${entries.map((e) => JSON.stringify(e)).join(",\n")}\n]}`;
  };
  return `${JSON.stringify(head).slice(0, -1)},"cases":[\n${cases.map(block).join(",\n")}\n]}\n`;
}

export const corpusDigest = (corpus: Corpus) => createHash("sha256").update(corpusToJson(corpus)).digest("hex");
