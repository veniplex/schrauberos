import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { readTrustAnchors, readTrustAnchorsChecked } from "../../../scripts/lib/trust.mjs";
import * as releaseKey from "../../modules/admin/updates/release-key.ts";
import { TEST_RELEASE, TEST_ROOT, TEST_SECOND } from "./testdata/anchor/test-keys.ts";

/**
 * Die Schlüssel des Starters kommen aus einem Textmuster über `release-key.ts` (scripts/lib/trust.mjs → Header im Image), die App wertet dieselbe Datei als TypeScript aus.
 * Beide Wege müssen dieselben Schlüssel ergeben – sonst vertrauten Starter und App verschiedenen Schlüsseln.
 */
const work = mkdtempSync(path.join(tmpdir(), "so-anchors-"));
after(() => rmSync(work, { recursive: true, force: true }));

const normal = (pem: string) => pem.trim();
let counter = 0;
const write = (source: string) => {
  const file = path.join(work, `release-key-${counter++}.ts`);
  writeFileSync(file, source);
  return file;
};

describe("Vertrauensanker: Textmuster und Auswertung der Datei", () => {
  it("die echte release-key.ts: beide Wege liefern dieselben Schlüssel (Wurzel noch = Release: rootPem fehlt im Textmuster)", async () => {
    const text = readTrustAnchors();
    const checked = await readTrustAnchorsChecked();
    assert.equal(normal(text.releasePem), normal(releaseKey.RELEASE_PUBLIC_KEY));
    assert.equal(normal(text.rootPem ?? text.releasePem), normal(releaseKey.ROOT_PUBLIC_KEY));
    assert.deepEqual(checked, text);
  });

  it("eigener Wurzelschlüssel als Literal: beide Wege stimmen überein", async () => {
    const file = write(`export const RELEASE_PUBLIC_KEY = \`${TEST_RELEASE.publicPem}\`;\nexport const ROOT_PUBLIC_KEY = \`${TEST_ROOT.publicPem}\`;\n`);
    const anchors = await readTrustAnchorsChecked(file);
    assert.equal(normal(anchors.releasePem), normal(TEST_RELEASE.publicPem));
    assert.equal(normal(anchors.rootPem ?? ""), normal(TEST_ROOT.publicPem));
  });

  it("ein Schlüssel in einem Kommentar vor der echten Zuweisung gewinnt nie", async () => {
    const file = write(
      [
        "/**",
        " * Beispiele (Kommentar):",
        ` * RELEASE_PUBLIC_KEY = \`${TEST_SECOND.publicPem}\``,
        ` * export const ROOT_PUBLIC_KEY = \`${TEST_SECOND.publicPem}\``,
        " */",
        `export const RELEASE_PUBLIC_KEY = \`${TEST_RELEASE.publicPem}\`;`,
        `export const ROOT_PUBLIC_KEY = \`${TEST_ROOT.publicPem}\`;`,
        "",
      ].join("\n"),
    );
    const anchors = await readTrustAnchorsChecked(file);
    assert.equal(normal(anchors.releasePem), normal(TEST_RELEASE.publicPem));
    assert.equal(normal(anchors.rootPem ?? ""), normal(TEST_ROOT.publicPem));
  });

  it("weicht die Auswertung vom Textmuster ab, bricht die Prüfung ab (kein stilles Auseinanderlaufen von Starter und App)", async () => {
    // Das Textmuster sähe den ersten Schlüssel, die Auswertung ergibt den zweiten
    const release = write(`export const RELEASE_PUBLIC_KEY = \`${TEST_RELEASE.publicPem}\` && \`${TEST_SECOND.publicPem}\`;\nexport const ROOT_PUBLIC_KEY = \`${TEST_ROOT.publicPem}\`;\n`);
    await assert.rejects(readTrustAnchorsChecked(release), /RELEASE_PUBLIC_KEY.*weichen ab/);
    const root = write(`export const RELEASE_PUBLIC_KEY = \`${TEST_RELEASE.publicPem}\`;\nexport const ROOT_PUBLIC_KEY = \`${TEST_ROOT.publicPem}\` && \`${TEST_SECOND.publicPem}\`;\n`);
    await assert.rejects(readTrustAnchorsChecked(root), /ROOT_PUBLIC_KEY.*weichen ab/);
  });
});
