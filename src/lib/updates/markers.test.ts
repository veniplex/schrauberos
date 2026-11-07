import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { cleanDetail, integrityCodeOf, integrityReason, parseInconclusive, parseVerifyFailed, parseVerifyOk, versionFromMarker } from "./markers";
import { afterFailure, afterInconclusive, afterIntegrityFailure, emptyState, INCONCLUSIVE_LIMIT, parseState } from "./state";
import { readSmallFile } from "./store";

const work = mkdtempSync(path.join(tmpdir(), "so-markers-"));
after(() => rmSync(work, { recursive: true, force: true }));

describe("Marker des Starters", () => {
  it("verify-failed: Version (nur der Basisname), Befundcode aus fester Liste, bereinigter Pfad", () => {
    assert.deepEqual(parseVerifyFailed("/data/app/versions/1.2.3\n15\nextra.txt\n"), { version: "1.2.3", code: 15, path: "extra.txt" });
    assert.deepEqual(parseVerifyFailed("1.2.3\n18\n\n"), { version: "1.2.3", code: 18, path: "" });
    for (const bad of ["", "1.2.3", "../../x\n15\n", "1.2.3\n17\n", "1.2.3\n19\n", "1.2.3\n0\n", "1.2.3\n99\n", "1.2.3\nabc\n", "x.y.z\n15\n", "1.2.3-dev\n15\n"]) assert.equal(parseVerifyFailed(bad), null, JSON.stringify(bad));
    assert.equal(parseVerifyFailed(`1.2.3\n15\n${"x".repeat(900)}`)!.path.length, 200);
    assert.equal(parseVerifyFailed("1.2.3\n15\n\u001b[2Jgone\u0007")!.path, "?[2Jgone?");
  });

  it("inconclusive: unbekannte Gründe werden zu 'other'", () => {
    assert.deepEqual(parseInconclusive("1.2.3\ntimeout\n"), { version: "1.2.3", reason: "timeout" });
    assert.deepEqual(parseInconclusive("/x/1.2.3\nirgendwas\n"), { version: "1.2.3", reason: "other" });
    assert.equal(parseInconclusive("nope\nio\n"), null);
  });

  it("verify-ok: fünf Zeilen, Zahlen streng", () => {
    assert.deepEqual(parseVerifyOk("1.2.3\n8412\n242000000\n2100\n1790000000\n"), { version: "1.2.3", files: 8412, bytes: 242000000, ms: 2100, at: new Date(1790000000 * 1000).toISOString() });
    for (const bad of ["", "1.2.3\n1\n2\n3\n", "1.2.3\n1\n2\n3\nx\n", "1.2.3\n-1\n2\n3\n4\n", "bad\n1\n2\n3\n4\n", "1.2.3\n1\n2\n3\n99999999999999\n"]) assert.equal(parseVerifyOk(bad), null, JSON.stringify(bad));
  });

  it("versionFromMarker und cleanDetail", () => {
    assert.equal(versionFromMarker("/data/app/versions/0.3.0\n"), "0.3.0");
    assert.equal(versionFromMarker("..\\..\\0.3.0"), "0.3.0");
    assert.equal(versionFromMarker("/data/app/versions/.."), null);
    assert.equal(cleanDetail("a\nb\tc"), "a?b?c");
    assert.equal(integrityReason(15), "integrity:15");
    assert.equal(integrityCodeOf("integrity:15"), 15);
    assert.equal(integrityCodeOf("antwortet nicht gesund"), null);
    assert.equal(integrityCodeOf(undefined), null);
  });
});

describe("Zustand bei Integritätsbefunden", () => {
  const base = { ...emptyState(), current: "1.2.0", previous: "1.1.0" };

  it("sperrt die aktuelle Version und fällt auf die Vorversion zurück", () => {
    const s = afterIntegrityFailure(base, "1.2.0", "integrity:15", "t", "extra.txt");
    assert.deepEqual([s.current, s.previous, s.pending, s.failed], ["1.1.0", null, false, ["1.2.0"]]);
    assert.deepEqual(s.last, { at: "t", version: "1.2.0", status: "rolled-back", reason: "integrity:15", detail: "extra.txt" });
  });

  it("sperrt eine Vorversion, ohne die aktuelle anzufassen", () => {
    const s = afterIntegrityFailure(base, "1.1.0", "integrity:16", "t");
    assert.deepEqual([s.current, s.previous, s.failed], ["1.2.0", null, ["1.1.0"]]);
  });

  it("zählt unklare Prüfungen je Version; ein Wechsel der Version beginnt neu", () => {
    let s = afterInconclusive(base, "1.2.0", "signal", "t1");
    s = afterInconclusive(s, "1.2.0", "timeout", "t2");
    assert.equal(s.inconclusive?.count, 2);
    assert.equal(s.inconclusive?.reason, "timeout");
    assert.equal(afterInconclusive(s, "1.1.0", "io", "t3").inconclusive?.count, 1);
    assert.equal(INCONCLUSIVE_LIMIT, 3);
  });

  it("der Rückfall nach einem Befund räumt den Zähler der gesperrten Version", () => {
    const s = afterInconclusive(base, "1.2.0", "io", "t");
    assert.equal(afterIntegrityFailure(s, "1.2.0", "integrity:15", "t").inconclusive, null);
    assert.equal(afterFailure(s, "x", "t").inconclusive, null);
  });

  it("parseState übernimmt detail und inconclusive, ignoriert Unsinn", () => {
    const s = parseState({ schema: 1, current: null, last: { at: "a", version: "1.0.0", status: "rolled-back", reason: "integrity:15", detail: "x".repeat(500) }, inconclusive: { version: "1.2.0", count: 2, at: "t", reason: "signal" } });
    assert.equal(s.last?.detail?.length, 200);
    assert.deepEqual(s.inconclusive, { version: "1.2.0", count: 2, at: "t", reason: "signal" });
    assert.equal(parseState({ schema: 1, inconclusive: { version: "1.2.0", count: 0, at: "t", reason: "x" } }).inconclusive, null);
    assert.equal(parseState({ schema: 1, inconclusive: "x" }).inconclusive, null);
  });
});

describe("readSmallFile: Marker sind Daten", () => {
  it("liest kleine reguläre Dateien, begrenzt die Größe, meldet Fehlendes als null und folgt keinem Symlink", () => {
    const file = path.join(work, "marker");
    writeFileSync(file, "1.2.3\n15\n");
    assert.equal(readSmallFile(file), "1.2.3\n15\n");
    writeFileSync(file, "x".repeat(10_000));
    assert.equal(readSmallFile(file)!.length, 4096);
    assert.equal(readSmallFile(path.join(work, "gibt-es-nicht")), null);
    mkdirSync(path.join(work, "ordner"));
    assert.equal(readSmallFile(path.join(work, "ordner")), null, "ein Ordner ist keine Datei");
    try {
      symlinkSync(file, path.join(work, "link"));
    } catch {
      return; // keine Symlinks (Windows ohne Rechte)
    }
    if (process.platform !== "win32") assert.equal(readSmallFile(path.join(work, "link")), null, "O_NOFOLLOW");
  });
});
