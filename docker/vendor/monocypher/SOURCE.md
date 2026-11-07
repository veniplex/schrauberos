# Monocypher (vendort)

* **Projekt:** Monocypher, Loup Vaillant – https://monocypher.org/
* **Version:** 4.0.3 (veröffentlicht 2026-06-15; behebt ein Zeitleck bei EdDSA-Signaturen, das die Prüfung nicht berührt)
* **Lizenz:** BSD-2-Clause **oder** CC0-1.0 (`LICENCE.md`, `SPDX-License-Identifier: BSD-2-Clause OR CC0-1.0` in den Quelldateien)
* **Verwendet:** `monocypher.c/.h` (Kurve, Ed25519-Prüfgleichung) und `monocypher-ed25519.c/.h` (SHA-512, `crypto_ed25519_check`). Nur Prüfen und Hashen, kein Signieren im Starter.

## Herkunft und Prüfsummen (am 2026-11-07 gegen zwei unabhängige Quellen geprüft)

1. **Release-Tarball** `https://monocypher.org/download/monocypher-4.0.3.tar.gz` (940 390 Bytes)
   * SHA-512 `40904ada5c7ee4f7741733e38b69a30a4b0561cbffba5ffe7c2dce16136d540251ec0d9056ff606510d3b5b708fb8a40db7e0870d4a0b2dc17ba2bfb880f8965`
     – stimmt mit der Datei `monocypher-4.0.3.tar.gz.sha512` auf monocypher.org überein
   * BLAKE2b `5c586019e8e78ce6fb70f73f4ded10c852335138394b22fb704d0b4379edfc1adaea342f0e4c4b8c52fcf053df401d1fe47812ee5cb5062813de19fc51f8ae93`
     – stimmt mit `monocypher-4.0.3.tar.gz.blake2b` überein
   * SHA-256 (nur zur Dokumentation) `8cc9bc341a66249016db9bd70e9142d8d0aef9945973744b1ac05dbc55d8ee66`
2. **Git-Tag** `4.0.3` im Repository `https://github.com/LoupVaillant/Monocypher` (Commit `ab2b16dd619ad5f6979a4fbe69cfa324a6fcc35f`; der Tag ist leichtgewichtig, also nicht signiert):
   `src/monocypher.c`, `src/monocypher.h`, `src/optional/monocypher-ed25519.c`, `src/optional/monocypher-ed25519.h` sind **byte-gleich** zum Tarball bis auf die erste Zeile
   (`// Monocypher version 4.0.3` im Tarball, `__git__` im Repository – das Release-Skript setzt die Versionsnummer ein). `LICENCE.md` des Tarballs ist eine Teilmenge der
   Repository-Datei (dort steht zusätzlich ein Hinweis zu `tests/externals/`, das hier nicht vendort wird).

Die Dateien hier sind die des Tarballs, **unverändert**. `SHA256SUMS` hält ihre Prüfsummen fest; `src/lib/updates/vendor-monocypher.test.ts` bricht bei jeder Abweichung ab.
Aktualisieren: neuen Tarball laden, beide Quellen wie oben prüfen, Dateien ersetzen, `SHA256SUMS`, `VERSION` und diese Datei anpassen, alle Tests unter `docker/test` laufen lassen.

## Hinweis zur Prüfung

Die Cure53-Prüfung (2017/18) bezieht sich auf eine ältere Linie. Darum gelten im Projekt zusätzlich die RFC-8032-Vektoren, die Wycheproof-Fälle (S ≥ L, Punkte kleiner Ordnung,
nicht-kanonische R/A) und ein Differentialtest gegen `node:crypto` (`docker/test`).
