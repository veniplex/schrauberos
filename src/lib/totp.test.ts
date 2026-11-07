import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BACKUP_CODE_COUNT, generateBackupCodes, hashBackupCode, normalizeBackupCode } from "./backup-codes";
import { ipHint } from "./ip-hint";
import qrcode from "qrcode-generator";
import { QR_MAX_BYTES, qrMatrix, QrTooLongError } from "./qr";
import { base32Decode, base32Encode, generateTotpSecret, hotp, matchTotp, normalizeTotpCode, otpauthUri, timeStep, totp, TOTP_SECRET_BYTES } from "./totp";
import { describeAgent } from "./user-agent";

/** Testvektoren aus RFC 6238, Anhang B (8 Stellen; je Algorithmus ein eigenes Geheimnis) */
const SHA1 = Buffer.from("12345678901234567890");
const SHA256 = Buffer.from("12345678901234567890123456789012");
const SHA512 = Buffer.from("1234567890123456789012345678901234567890123456789012345678901234");
const VECTORS: Array<[number, string, string, string]> = [
  // Zeit (s), SHA-1, SHA-256, SHA-512
  [59, "94287082", "46119246", "90693936"],
  [1111111109, "07081804", "68084774", "25091201"],
  [1111111111, "14050471", "67062674", "99943326"],
  [1234567890, "89005924", "91819424", "93441116"],
  [2000000000, "69279037", "90698825", "38618901"],
  [20000000000, "65353130", "77737706", "47863826"],
];

describe("TOTP (RFC 6238)", () => {
  it("liefert die Testvektoren des RFC für SHA-1, SHA-256 und SHA-512", () => {
    for (const [seconds, sha1, sha256, sha512] of VECTORS) {
      assert.equal(totp(SHA1, seconds * 1000, 8, "sha1"), sha1, `SHA-1 bei ${seconds}`);
      assert.equal(totp(SHA256, seconds * 1000, 8, "sha256"), sha256, `SHA-256 bei ${seconds}`);
      assert.equal(totp(SHA512, seconds * 1000, 8, "sha512"), sha512, `SHA-512 bei ${seconds}`);
    }
  });

  it("HOTP (RFC 4226, Anhang D): die ersten Werte des Beispiel-Geheimnisses", () => {
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    expected.forEach((code, counter) => assert.equal(hotp(SHA1, counter), code));
  });

  it("Base32: RFC-4648-Vektoren, tolerante Eingabe, fremde Zeichen werden abgelehnt", () => {
    const pairs: Array<[string, string]> = [["", ""], ["f", "MY"], ["fo", "MZXQ"], ["foo", "MZXW6"], ["foob", "MZXW6YQ"], ["fooba", "MZXW6YTB"], ["foobar", "MZXW6YTBOI"]];
    for (const [text, encoded] of pairs) {
      assert.equal(base32Encode(Buffer.from(text)), encoded);
      assert.equal(base32Decode(encoded)?.toString(), text);
    }
    assert.equal(base32Decode("mzxw 6ytb-oi===")?.toString(), "foobar");
    assert.equal(base32Decode("MZXW1"), null, "1 gehört nicht zum Alphabet");
    const secret = generateTotpSecret();
    assert.equal(secret.length, TOTP_SECRET_BYTES);
    assert.deepEqual(base32Decode(base32Encode(secret)), secret);
  });

  const secret = Buffer.from("12345678901234567890");
  const NOW = 1_700_000_000_000;
  const step = timeStep(NOW);

  it("akzeptiert den aktuellen Code und je einen Zeitschritt davor und danach, nicht mehr", () => {
    assert.equal(matchTotp(secret, totp(secret, NOW), NOW), step);
    assert.equal(matchTotp(secret, totp(secret, NOW - 30_000), NOW), step - 1);
    assert.equal(matchTotp(secret, totp(secret, NOW + 30_000), NOW), step + 1);
    assert.equal(matchTotp(secret, totp(secret, NOW - 60_000), NOW), null);
    assert.equal(matchTotp(secret, totp(secret, NOW + 60_000), NOW), null);
  });

  it("ein Zeitschritt gilt nur einmal: Schritte bis einschließlich lastStep werden abgelehnt", () => {
    const code = totp(secret, NOW);
    assert.equal(matchTotp(secret, code, NOW, { lastStep: step - 1 }), step);
    assert.equal(matchTotp(secret, code, NOW, { lastStep: step }), null);
    assert.equal(matchTotp(secret, code, NOW, { lastStep: step + 5 }), null);
    // der vorige Schritt ist nach Benutzung des aktuellen nicht mehr gültig (kein Zurückspulen)
    assert.equal(matchTotp(secret, totp(secret, NOW - 30_000), NOW, { lastStep: step }), null);
  });

  it("nimmt Leerzeichen und Bindestriche in der Eingabe hin, lehnt alles andere ab", () => {
    const code = totp(secret, NOW);
    assert.equal(matchTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, NOW), step);
    assert.equal(matchTotp(secret, `${code.slice(0, 3)}-${code.slice(3)}`, NOW), step);
    for (const bad of ["", "12345", "1234567", "abcdef", "12345a", `${code}0`, " "]) assert.equal(matchTotp(secret, bad, NOW), null, bad);
    assert.equal(normalizeTotpCode("123 456"), "123456");
    assert.equal(normalizeTotpCode("12345"), null);
  });

  it("otpauth-Adresse: Aussteller, Konto, Geheimnis und die Vorgaben der Apps; Sonderzeichen werden kodiert", () => {
    const uri = otpauthUri({ issuer: "Werkstatt: Meyer & Söhne", account: "anna.m@example.org", secret });
    assert.ok(uri.startsWith("otpauth://totp/Werkstatt%20%20Meyer%20%26%20S%C3%B6hne:anna.m%40example.org?"));
    assert.match(uri, /secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ(?:&|$)/);
    assert.match(uri, /algorithm=SHA1&digits=6&period=30$/);
    assert.ok(otpauthUri({ issuer: "", account: "x", secret }).includes("SchrauberOS"));
  });
});

describe("QR-Code", () => {
  it("liefert eine quadratische Matrix mit Suchmustern in den drei Ecken", () => {
    const { size, rows } = qrMatrix(otpauthUri({ issuer: "SchrauberOS", account: "anna", secret: generateTotpSecret() }));
    assert.ok(size >= 25 && (size - 17) % 4 === 0, `Größe ${size} passt zu keiner QR-Version`);
    assert.equal(rows.length, size);
    assert.ok(rows.every((row) => row.length === size && /^[01]+$/.test(row)));
    // Suchmuster: 7×7-Block, außen dunkel, Ring hell, Mitte dunkel – oben links, oben rechts, unten links
    for (const [x0, y0] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
      assert.equal(rows[y0][x0], "1");
      assert.equal(rows[y0 + 1][x0 + 1], "0");
      assert.equal(rows[y0 + 3][x0 + 3], "1");
      assert.equal(rows[y0 + 6][x0 + 6], "1");
    }
  });
});

describe("QR-Code: Zeichenkodierung", () => {
  /** Matrix aus den UTF-8-Bytes, unabhängig von `qrMatrix` gebaut */
  function reference(text: string): string[] {
    qrcode.stringToBytes = (value: string) => [...Buffer.from(value, "utf8")];
    const qr = qrcode(0, "M");
    qr.addData(text, "Byte");
    qr.make();
    const rows: string[] = [];
    for (let y = 0; y < qr.getModuleCount(); y++) rows.push(Array.from({ length: qr.getModuleCount() }, (_, x) => (qr.isDark(y, x) ? "1" : "0")).join(""));
    return rows;
  }

  it("kodiert als UTF-8: „€“ und „¬“ ergeben verschiedene Codes (vorher dasselbe untere Byte)", () => {
    assert.notDeepEqual(qrMatrix("€").rows, qrMatrix("¬").rows);
    assert.deepEqual(qrMatrix("€").rows, reference("€"));
  });

  it("Girocode-Beispiel mit Umlauten und Euro entspricht der UTF-8-Bytefolge", () => {
    const epc = ["BCD", "002", "1", "SCT", "GENODEF1XXX", "Müller & Söhne Kfz-Meisterbetrieb GmbH", "DE89370400440532013000", "EUR123.45", "", "RE-2026-0001 Größe € Ölwechsel"].join(String.fromCharCode(10));
    assert.deepEqual(qrMatrix(epc).rows, reference(epc));
  });

  it("zu langer Inhalt ist ein echter Fehler (QrTooLongError), keine geworfene Zeichenkette", () => {
    assert.throws(() => qrMatrix("a".repeat(QR_MAX_BYTES + 1)), (error: unknown) => error instanceof QrTooLongError && error instanceof Error);
    assert.throws(() => qrMatrix("€".repeat(900)), QrTooLongError); // 2700 Bytes
    assert.ok(qrMatrix("a".repeat(QR_MAX_BYTES)).size === 177);
  });
});

describe("Sicherungscodes", () => {
  it("10 verschiedene Codes zu 16 Zeichen in vier Gruppen; die Eingabe ist tolerant (O/0, I/L/1, Klein, Trenner)", () => {
    const codes = generateBackupCodes();
    assert.equal(codes.length, BACKUP_CODE_COUNT);
    assert.equal(new Set(codes).size, BACKUP_CODE_COUNT);
    for (const code of codes) {
      assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
      assert.equal(normalizeBackupCode(code), code.replaceAll("-", ""));
      assert.equal(normalizeBackupCode(code.toLowerCase().replaceAll("-", " ")), code.replaceAll("-", ""));
    }
    assert.equal(normalizeBackupCode("OOOO-IIII-LLLL-0011"), "0000111111110011");
    for (const bad of ["", "ABCD", "ABCD-EFGH-JKMN-PQR", "ABCD-EFGH-JKMN-PQRSS", "ABCD-EFGH-JKMN-PQRU", "ABCD-EFGH-JKMN-PQR!"]) assert.equal(normalizeBackupCode(bad), null, bad);
  });

  it("der Hash ist an das Konto gebunden und enthält den Code nicht im Klartext", () => {
    const a = hashBackupCode("user-a", "ABCDEFGHJKMNPQRS");
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.notEqual(a, hashBackupCode("user-b", "ABCDEFGHJKMNPQRS"));
    assert.equal(a, hashBackupCode("user-a", "ABCDEFGHJKMNPQRS"));
  });
});

describe("Anzeigehilfen für Sitzungen und Geräte", () => {
  it("erkennt Browser und System grob", () => {
    const cases: Array<[string, string, string]> = [
      ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", "Chrome", "Windows"],
      ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0", "Edge", "Windows"],
      ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15", "Safari", "macOS"],
      ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", "Safari", "iOS"],
      ["Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0", "Firefox", "Linux"],
      ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36", "Chrome", "Android"],
    ];
    for (const [ua, browser, os] of cases) assert.deepEqual(describeAgent(ua), { browser, os }, ua);
    assert.deepEqual(describeAgent(null), { browser: null, os: null });
    assert.deepEqual(describeAgent("curl/8.0"), { browser: null, os: null });
  });

  it("kürzt Adressen auf einen groben Teil und lehnt Unbrauchbares ab", () => {
    assert.equal(ipHint("192.168.1.77"), "192.168.1.x");
    assert.equal(ipHint("2001:db8:abcd:12:1:2:3:4"), "2001:db8:abcd::/48");
    assert.equal(ipHint("2001:db8::1"), "2001:db8:0::/48");
    assert.equal(ipHint("::1"), "0:0:0::/48");
    for (const bad of [null, undefined, "", "not-an-ip", "999.1.1.1"]) assert.equal(ipHint(bad), null);
  });
});
