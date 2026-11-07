#!/bin/sh
# Übersetzt den Starter (Dockerfile, Stufen bootstrap-build und bootstrap-test-build – ein gemeinsamer Ort für beide, damit sich Produktions- und Testbinary nur im Header
# mit den Schlüsseln unterscheiden). Erwartet in /src: bootstrap.c, verify.c, verify.h, vendor/monocypher und den generierten trust-keys.h. Ergebnis: /bootstrap.
# Eigener Code mit -Werror und den strengen Warnungen der Produktion (-Wconversion -Wshadow -Wformat=2); die vendorte Bibliothek (docker/vendor/monocypher) wird getrennt und
# ohne -Wconversion übersetzt. SOS_PRODUCTION verbietet die Test-Konstanten (README „Starter-Vertrauensanker“).
set -eu
cd /src

# Die vendorte Bibliothek muss byte-genau der geprüften entsprechen (Prüfsummen gegen die Tarball-Quelle in SOURCE.md; der Test im Repository prüft dasselbe, das Image prüft es nochmals)
(cd vendor/monocypher && sha256sum -c SHA256SUMS)
gcc --version | head -n1

harden="-O2 -fPIE -fstack-protector-strong -D_FORTIFY_SOURCE=2 -D_FILE_OFFSET_BITS=64"
gcc $harden -Wall -Wextra -c -Ivendor/monocypher vendor/monocypher/monocypher.c vendor/monocypher/monocypher-ed25519.c
gcc $harden -Wall -Wextra -Wformat=2 -Wconversion -Wshadow -Werror -DSOS_PRODUCTION=1 -Ivendor/monocypher -I. -c bootstrap.c verify.c
gcc -static-pie -Wl,-z,relro,-z,now -s -o /bootstrap bootstrap.o verify.o monocypher.o monocypher-ed25519.o

# Ein statisches PIE hat keinen Interpreter (INTERP) und keine dynamischen Abhängigkeiten; Härtung vorhanden
if readelf -lW /bootstrap | grep -q INTERP; then
  echo "Der Starter ist nicht statisch gelinkt (INTERP vorhanden) – im Image gibt es keine Bibliotheken." >&2
  exit 1
fi
if readelf -dW /bootstrap | grep -q NEEDED; then
  echo "Der Starter hat dynamische Abhängigkeiten (NEEDED)." >&2
  exit 1
fi
readelf -dW /bootstrap | grep -q BIND_NOW
readelf -lW /bootstrap | grep -q GNU_RELRO
echo "Starter übersetzt: $(sha256sum /bootstrap | cut -c1-16) ($(wc -c < /bootstrap) Bytes)"
