import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

/** `scripts/gen-notices.mjs`: THIRD-PARTY-NOTICES.md für das Paket (Z6-3 M-9). */
const work = mkdtempSync(path.join(tmpdir(), "so-notices-"));
after(() => rmSync(work, { recursive: true, force: true }));

const pkg = (root: string, rel: string, json: object) => {
  const dir = path.join(root, "node_modules", ...rel.split("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "package.json"), JSON.stringify(json));
};

describe("gen-notices", () => {
  it("listet jedes Paket (auch gescopte und verschachtelte) mit Version, Lizenz und Herkunft; Debian-Lizenztexte werden angehängt, soweit vorhanden", async () => {
    const { pathToFileURL } = await import("node:url");
    const { buildNotices, listPackages } = (await import(pathToFileURL(path.join(process.cwd(), "scripts", "gen-notices.mjs")).href)) as typeof import("../../../scripts/gen-notices.mjs");
    const root = path.join(work, "bundle");
    pkg(root, "next", { name: "next", version: "16.4.5", license: "MIT", homepage: "https://nextjs.org" });
    pkg(root, "@scope/pkg", { name: "@scope/pkg", version: "1.2.3", license: { type: "ISC" }, repository: { url: "git+https://example.org/x.git" } });
    pkg(root, "next/node_modules/inner", { name: "inner", version: "0.1.0", licenses: [{ type: "Apache-2.0" }, "BSD-3-Clause"] });
    pkg(root, "ohne-lizenz", { name: "ohne-lizenz", version: "9.9.9" });
    const docs = path.join(work, "doc");
    mkdirSync(path.join(docs, "libc6"), { recursive: true });
    writeFileSync(path.join(docs, "libc6", "copyright"), "GNU C Library: LGPL-2.1+\n");
    const found = listPackages(root).map((p) => `${p.name}@${p.version}:${p.license}`);
    assert.deepEqual(found, ["@scope/pkg@1.2.3:ISC", "inner@0.1.0:Apache-2.0 OR BSD-3-Clause", "next@16.4.5:MIT", "ohne-lizenz@9.9.9:unbekannt"]);
    const { text, packages } = buildNotices(root, { docsDir: docs });
    assert.equal(packages, 4);
    assert.match(text, /\| next \| 16\.4\.5 \| MIT \| https:\/\/nextjs\.org \|/);
    assert.match(text, /\| @scope\/pkg \| 1\.2\.3 \| ISC \| https:\/\/example\.org\/x\.git \|/);
    assert.match(text, /### Debian-Paket libc6[\s\S]*LGPL-2\.1\+/);
    assert.ok(!text.includes("libstdc++6\n\n```"), "nicht vorhandene Texte werden übersprungen");
    assert.match(text, /LGPL-2\.1 oder später/);
  });
});
