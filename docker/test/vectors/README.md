# Testvektoren des Starters (docker/test/crypto-test.c, run.mjs Stufe `crypto`)

Unverändert aus den Originalquellen übernommen (`-text` in `.gitattributes`: keine Zeilenenden-Umwandlung). Stand der Abholung: 2026-11-07.

| Datei | Quelle | Lizenz / Status | SHA-256 |
| --- | --- | --- | --- |
| `ed25519-rfc8032.txt` | RFC 8032, Abschnitt 7.1 (`https://www.rfc-editor.org/rfc/rfc8032.txt`): öffentlicher Schlüssel, Nachricht, Signatur der fünf Ed25519-Vektoren, aus dem RFC-Text ausgelesen (Längenangaben des RFC gegengeprüft) | RFC-Text | `7ec74276f67933cf19fda2f2bac97c71e61b4ba3c85fbc183012419f71212f00` |
| `ed25519-wycheproof.json` | Project Wycheproof, `testvectors_v1/ed25519_test.json` (`https://github.com/C2SP/wycheproof`), 210 Fälle | Apache-2.0 | `ea80ffebac085e21cb9d3e903e7fa2b448d96702da5b31f061d0b83b430b74b3` |
| `sha512-nist-short.rsp`, `sha512-nist-long.rsp` | NIST CAVP „SHA-512 ShortMsg/LongMsg“ aus `shabytetestvectors.zip` (`https://csrc.nist.gov/…/shs/shabytetestvectors.zip`, 129 + 128 Vektoren, Byte-orientiert, 0 bis 2 048 Bit in Achterschritten, deckt die Blockgrenzen ab) | Veröffentlichung des NIST (gemeinfrei) | `e53a36c03609e5a3e3cc4b6e117a499db7864c23ec825c6cec99503a45f40764` (short), `b1f3f05d5c209777954d49521d7ea1349447c36a0c52849e044bc397a27dd410` (long) |

Nicht als Datei abgelegt: „eine Million ‚a‘“ (FIPS 180-2, steht im Test) und die 6 000 Differenzfälle gegen `node:crypto` (werden bei jedem Lauf deterministisch erzeugt).

Wycheproof-Ergebnis für Monocypher 4.0.3 mit der Prüfung des Starters (`sos_ed25519_check`): alle 117 gültigen Fälle akzeptiert, alle 64 ungültigen abgelehnt, die 29 Fälle der Klasse „acceptable“ (Punkte kleiner oder gemischter Ordnung als öffentlicher
Schlüssel) akzeptiert. Ohne die Vorprüfung der Kodierung akzeptiert Monocypher `tcId` 151 (R mit `y = 1` und gesetztem Vorzeichenbit; Monocypher erlaubt nicht-kanonische Kodierungen von R und A bewusst) – darum weist `sos_ed25519_check` solche Kodierungen ab.
