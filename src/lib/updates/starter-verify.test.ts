import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseStarterVerdict, starterArgs } from "./starter-verify";

describe("Aufruf und Ergebnis von /bootstrap --verify", () => {
  it("baut die Argumente: Version, Ablaufdatum heute (UTC)", () => {
    assert.deepEqual(starterArgs("/data/app/versions/.partial-1.2.3", "1.2.3", new Date("2026-11-07T23:59:59Z")), ["--verify", "/data/app/versions/.partial-1.2.3", "--expect-version", "1.2.3", "--check-expiry", "2026-11-07"]);
  });

  it("Erfolg: Exit 0 und die JSON-Zeile", () => {
    const r = parseStarterVerdict(0, '{"ok":true,"version":"1.2.3","files":12,"bytes":3456,"ms":78,"floor":"above"}\n');
    assert.deepEqual(r, { ok: true, version: "1.2.3", files: 12, bytes: 3456, ms: 78, floor: "above" });
  });

  it("Befund: der Exit-Code ist die Aussage, Grund und Pfad kommen aus der Zeile (bereinigt, gekürzt)", () => {
    const r = parseStarterVerdict(15, '{"ok":false,"code":15,"reason":"extra","path":"a\\u0001b","ms":4}\n');
    assert.deepEqual(r, { ok: false, code: 15, reason: "extra", path: "a?b" });
    const long = parseStarterVerdict(16, JSON.stringify({ ok: false, code: 16, reason: "hash", path: "x".repeat(500) }));
    assert.equal(long.ok === false ? long.path?.length : null, 200);
    // ein widersprüchliches „code“ in der Zeile ändert den Exit-Code nicht
    const mismatch = parseStarterVerdict(18, '{"ok":false,"code":10,"reason":"x"}');
    assert.equal(mismatch.ok === false ? mismatch.code : null, 18);
  });

  it("veraltet (19) bleibt 19", () => {
    assert.deepEqual(parseStarterVerdict(19, '{"ok":false,"code":19,"reason":"floor","path":"","ms":1}'), { ok: false, code: 19, reason: "floor" });
  });

  it("Signal, Zeitüberschreitung, Fremdcodes und unlesbare Ausgabe sind ‚Ein-/Ausgabefehler‘ (17), nie ein Befund", () => {
    for (const [code, out] of [
      [null, ""],
      [0, "kein JSON"],
      [0, '{"ok":false}'],
      [0, '{"ok":true,"version":"1.0.0","files":-1,"bytes":1,"ms":1,"floor":"above"}'],
      [1, ""],
      [139, ""],
    ] as const) {
      const r = parseStarterVerdict(code, out);
      assert.equal(r.ok, false, String(code));
      assert.equal(r.ok === false ? r.code : null, 17, `${code} ${out}`);
    }
  });

  it("ein Befundcode ohne lesbare Zeile bleibt der Exit-Code", () => {
    assert.deepEqual(parseStarterVerdict(13, "Müll"), { ok: false, code: 13, reason: "unknown" });
  });
});
