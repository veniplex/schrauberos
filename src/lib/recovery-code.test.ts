import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { bytesToDataChars, DATA_CHARS, formatRecoveryCode, parseRecoveryCode, RECOVERY_ALPHABET } from "./recovery-code";

describe("Wiederherstellungs-Code: Format", () => {
  it("160 Bit Nutzdaten, 8 Gruppen à 4 Zeichen + Prüfzeichen, aus dem Alphabet", () => {
    const code = formatRecoveryCode(bytesToDataChars(randomBytes(20)));
    assert.match(code, /^([0-9A-HJKMNP-TV-Z]{5}-){7}[0-9A-HJKMNP-TV-Z]{5}$/);
    assert.equal(bytesToDataChars(new Uint8Array(20)).length, DATA_CHARS);
  });

  it("bytesToDataChars: bekannte Werte (alle Nullen, alle 0xFF)", () => {
    assert.equal(bytesToDataChars(new Uint8Array(20)), "0".repeat(32));
    assert.equal(bytesToDataChars(new Uint8Array(20).fill(255)), "Z".repeat(32));
    assert.throws(() => bytesToDataChars(new Uint8Array(19)));
  });

  it("Zufallscodes sind verschieden und lesen sich zurück (auch klein geschrieben, mit Leerzeichen, O/I/L-Verwechslung)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const data = bytesToDataChars(randomBytes(20));
      const code = formatRecoveryCode(data);
      seen.add(code);
      assert.deepEqual(parseRecoveryCode(code), { ok: true, data });
      assert.deepEqual(parseRecoveryCode(` ${code.toLowerCase().replaceAll("-", " ")} `), { ok: true, data });
    }
    assert.equal(seen.size, 200);
    const zeros = formatRecoveryCode("0".repeat(32));
    assert.equal(parseRecoveryCode(zeros.replaceAll("0", "O")).ok, true);
    const ones = formatRecoveryCode("1".repeat(32));
    assert.equal(parseRecoveryCode(ones.replaceAll("1", "l")).ok, true);
  });

  it("jeder einzelne Tippfehler wird erkannt und die Gruppe genannt", () => {
    const code = formatRecoveryCode(bytesToDataChars(randomBytes(20)));
    const plain = code.replaceAll("-", "");
    for (let pos = 0; pos < plain.length; pos++) {
      for (const replacement of RECOVERY_ALPHABET) {
        if (replacement === plain[pos]) continue;
        const wrong = plain.slice(0, pos) + replacement + plain.slice(pos + 1);
        const result = parseRecoveryCode(wrong);
        assert.equal(result.ok, false, `Position ${pos} → ${replacement}`);
        if (!result.ok) assert.equal(result.badGroup, Math.floor(pos / 5) + 1);
      }
    }
  });

  it("falsche Länge und fremde Zeichen", () => {
    const code = formatRecoveryCode(bytesToDataChars(randomBytes(20)));
    assert.deepEqual(parseRecoveryCode(code.slice(0, -1)), { ok: false, reason: "length" });
    assert.deepEqual(parseRecoveryCode(""), { ok: false, reason: "length" });
    assert.deepEqual(parseRecoveryCode(code.slice(0, -1) + "U"), { ok: false, reason: "chars" });
  });
});
