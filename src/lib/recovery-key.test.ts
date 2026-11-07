import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { formatRecoveryKey, keyBytesToChars, keyCharsToBytes, parseRecoveryKey } from "./recovery-key";

describe("Wiederherstellungsschlüssel (Format)", () => {
  it("rundet 256 Bit verlustfrei hin und zurück", () => {
    for (let i = 0; i < 200; i++) {
      const bytes = randomBytes(32);
      const parsed = parseRecoveryKey(formatRecoveryKey(bytes));
      assert.ok(parsed.ok);
      assert.ok(parsed.key.equals(bytes));
    }
    assert.ok(keyCharsToBytes(keyBytesToChars(Buffer.alloc(32, 0xff)))!.equals(Buffer.alloc(32, 0xff)));
    assert.ok(keyCharsToBytes(keyBytesToChars(Buffer.alloc(32)))!.equals(Buffer.alloc(32)));
  });

  it("hat 13 Gruppen zu 5 Zeichen und ist vom Notzugangs-Code (8 Gruppen) zu unterscheiden", () => {
    const text = formatRecoveryKey(randomBytes(32));
    assert.match(text, /^([0-9A-Z]{5}-){12}[0-9A-Z]{5}$/);
  });

  it("verzeiht Schreibweise, Leerzeichen und verwechselbare Zeichen", () => {
    const bytes = randomBytes(32);
    const text = formatRecoveryKey(bytes);
    const sloppy = text.toLowerCase().replace(/-/g, "  ").replace(/0/g, "o").replace(/1/g, "l");
    const parsed = parseRecoveryKey(sloppy);
    assert.ok(parsed.ok && parsed.key.equals(bytes));
  });

  it("meldet falsche Länge, falsche Zeichen und einzelne Tippfehler samt Gruppe", () => {
    const text = formatRecoveryKey(randomBytes(32));
    assert.deepEqual(parseRecoveryKey(text.slice(0, -1)), { ok: false, reason: "length" });
    assert.deepEqual(parseRecoveryKey(`${text.slice(0, 2)}U${text.slice(3)}`), { ok: false, reason: "chars" });
    const groups = text.split("-");
    const first = groups[2][0] === "A" ? "B" : "A";
    groups[2] = first + groups[2].slice(1);
    assert.deepEqual(parseRecoveryKey(groups.join("-")), { ok: false, reason: "checksum", badGroup: 3 });
  });

  it("lehnt Zeichenfolgen mit gesetzten Füllbits ab", () => {
    const chars = keyBytesToChars(randomBytes(32));
    const last = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    const bad = chars.slice(0, -1) + last[(last.indexOf(chars.at(-1)!) | 1) % 32];
    assert.equal(keyCharsToBytes(bad), null);
  });
});
