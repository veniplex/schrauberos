// Stufe „crypto“: Ed25519 (RFC 8032, Wycheproof, Differenz gegen node:crypto) und SHA-512 (NIST CAVP, Blockgrenzen, Million „a“) des vendorten Monocypher.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildDir, compile, compiler, repo, run, SANITIZE, vendorDir } from "./lib.mjs";

const vectors = join(repo, "docker/test/vectors");
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const L = 2n ** 252n + 27742317777372353535851937790883648493n;

/** Wycheproof (JSON) → Zeilenformat für crypto-test.c: <tcId> <result> <flags> <pk> <msg|-> <sig|-> */
function wycheproofLines() {
  const data = JSON.parse(readFileSync(join(vectors, "ed25519-wycheproof.json"), "utf8"));
  const lines = [];
  for (const group of data.testGroups) {
    for (const t of group.tests) lines.push(`${t.tcId} ${t.result} ${t.flags.join(",") || "-"} ${group.publicKey.pk} ${t.msg || "-"} ${t.sig || "-"}`);
  }
  return { text: lines.join("\n") + "\n", count: lines.length };
}

/** Deterministische Fälle für den Differentialtest: node:crypto signiert und urteilt, Monocypher muss gleich urteilen. */
function differentialLines(count = 1000) {
  const lines = [];
  const bytes = (label, n) => {
    let out = Buffer.alloc(0);
    for (let i = 0; out.length < n; i++) out = Buffer.concat([out, createHash("sha256").update(`${label}/${i}`).digest()]);
    return out.subarray(0, n);
  };
  const nodeVerdict = (pk, msg, sig) => {
    try {
      return verify(null, msg, createPublicKey({ key: Buffer.concat([SPKI_PREFIX, pk]), format: "der", type: "spki" }), sig) ? 1 : 0;
    } catch {
      return 0;
    }
  };
  const push = (label, pk, msg, sig) => {
    if (sig.length !== 64) return;
    lines.push(`${pk.toString("hex")} ${msg.length ? msg.toString("hex") : "-"} ${sig.toString("hex")} ${nodeVerdict(pk, msg, sig)} ${label}`);
  };
  for (let i = 0; i < count; i++) {
    const seed = bytes(`seed/${i}`, 32);
    const priv = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
    const pk = Buffer.from(createPublicKey(priv).export({ type: "spki", format: "der" }).subarray(SPKI_PREFIX.length));
    const msg = bytes(`msg/${i}`, bytes(`len/${i}`, 2).readUInt16BE() % 301);
    const sig = Buffer.from(sign(null, msg, priv));
    push(`valid-${i}`, pk, msg, sig);
    const r = bytes(`flip/${i}`, 6);
    const flipped = (buf, at) => {
      const copy = Buffer.from(buf);
      if (copy.length) copy[at % copy.length] ^= 1 << (r[5] % 8);
      return copy;
    };
    push(`flip-sig-${i}`, pk, msg, flipped(sig, r.readUInt16BE(0)));
    push(`flip-msg-${i}`, pk, flipped(msg, r.readUInt16BE(2)), sig);
    push(`flip-pk-${i}`, flipped(pk, r.readUInt16BE(4)), msg, sig);
    // S + L (Formbarkeit): S >= L muss abgelehnt werden
    const s = BigInt("0x" + Buffer.from(sig.subarray(32)).reverse().toString("hex"));
    const bigS = s + L;
    if (bigS < 2n ** 256n) push(`s-plus-l-${i}`, pk, msg, Buffer.concat([sig.subarray(0, 32), Buffer.from(bigS.toString(16).padStart(64, "0"), "hex").reverse()]));
    // S mit gesetztem Bit 255 (nicht kanonisch)
    const highS = Buffer.from(sig);
    highS[63] |= 0x80;
    push(`s-high-bit-${i}`, pk, msg, highS);
  }
  return { text: lines.join("\n") + "\n", count: lines.length };
}

export function cryptoStage(log) {
  mkdirSync(buildDir, { recursive: true });
  const wy = wycheproofLines();
  const diff = differentialLines();
  writeFileSync(join(buildDir, "wycheproof.txt"), wy.text);
  writeFileSync(join(buildDir, "diff.txt"), diff.text);
  const args = [
    "--rfc", join(vectors, "ed25519-rfc8032.txt"),
    "--sha-short", join(vectors, "sha512-nist-short.rsp"),
    "--sha-long", join(vectors, "sha512-nist-long.rsp"),
    "--wycheproof", join(buildDir, "wycheproof.txt"),
    "--diff", join(buildDir, "diff.txt"),
  ];
  const sources = [join(repo, "docker/test/crypto-test.c"), join(repo, "docker/verify.c"), join(vendorDir, "monocypher.c"), join(vendorDir, "monocypher-ed25519.c")];
  const ok = [];
  for (const [tag, flags] of [["prod", ["-std=gnu11", "-O2", "-Wall", "-Wextra", "-D_FILE_OFFSET_BITS=64"]], ["asan", [...SANITIZE, "-Wno-unused-parameter"]]]) {
    const bin = compile(join(buildDir, `crypto-test-${tag}`), sources, [...flags, `-I${vendorDir}`, `-I${join(repo, "docker")}`]);
    const r = run(bin, args);
    log(`crypto-test (${tag}):\n${r.stdout.trimEnd().split("\n").map((l) => "    " + l).join("\n")}${r.stderr ? "\n" + r.stderr : ""}`);
    ok.push(r.status === 0);
  }
  log(`  (Wycheproof-Fälle: ${wy.count}, Differenzfälle gegen node:crypto: ${diff.count}, Compiler: ${compiler.version})`);
  return ok.every(Boolean);
}
