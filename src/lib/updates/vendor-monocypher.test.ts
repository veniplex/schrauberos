import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Die vendorte Kryptobibliothek des Starters (docker/vendor/monocypher, README „Starter-Vertrauensanker“): Jede Abweichung von den festgeschriebenen Prüfsummen bricht ab –
 * eine Änderung an Fremdcode geschieht nur bewusst (neuer Tarball, beide Quellen prüfen, `SHA256SUMS` und `SOURCE.md` anpassen). Der Test liegt unter `src/`, damit `npm test` ihn findet.
 */
const repo = path.resolve(import.meta.dirname, "../../..");
const dir = path.join(repo, "docker/vendor/monocypher");
const read = (name: string) => readFileSync(path.join(dir, name));

describe("Monocypher (vendort)", () => {
  const sums = readFileSync(path.join(dir, "SHA256SUMS"), "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const m = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line);
      assert.ok(m, `Zeile in SHA256SUMS: ${line}`);
      return { sha256: m[1], file: m[2] };
    });

  it("jede Quelldatei entspricht ihrer festgeschriebenen SHA-256-Prüfsumme", () => {
    for (const { sha256, file } of sums) assert.equal(createHash("sha256").update(read(file)).digest("hex"), sha256, file);
  });

  it("SHA256SUMS nennt genau die Quellen, die der Starter braucht, samt Lizenz", () => {
    assert.deepEqual(sums.map((s) => s.file).sort(), ["AUTHORS.md", "LICENCE.md", "monocypher-ed25519.c", "monocypher-ed25519.h", "monocypher.c", "monocypher.h"]);
  });

  it("Version 4.0.3, in Quelle, VERSION und SOURCE.md übereinstimmend; Lizenz BSD-2-Clause oder CC0", () => {
    assert.equal(read("VERSION").toString().trim(), "Monocypher 4.0.3");
    for (const file of ["monocypher.c", "monocypher.h", "monocypher-ed25519.c", "monocypher-ed25519.h"]) {
      const text = read(file).toString("utf8");
      assert.ok(text.startsWith("// Monocypher version 4.0.3\n"), file);
      assert.match(text, /SPDX-License-Identifier: BSD-2-Clause OR CC0-1\.0/, file);
    }
    const source = readFileSync(path.join(dir, "SOURCE.md"), "utf8");
    assert.match(source, /40904ada5c7ee4f7741733e38b69a30a4b0561cbffba5ffe7c2dce16136d540251ec0d9056ff606510d3b5b708fb8a40db7e0870d4a0b2dc17ba2bfb880f8965/);
    assert.match(source, /ab2b16dd619ad5f6979a4fbe69cfa324a6fcc35f/);
  });

  it("keine Zeilenenden-Umwandlung (CR), und .gitattributes schützt die Dateien (-text)", () => {
    for (const { file } of sums) assert.equal(read(file).includes(0x0d), false, `${file} enthält CR`);
    const attributes = readFileSync(path.join(repo, ".gitattributes"), "utf8");
    assert.match(attributes, /^docker\/vendor\/\*\* -text$/m);
    assert.match(attributes, /^docker\/test\/vectors\/\*\* -text$/m);
  });
});
