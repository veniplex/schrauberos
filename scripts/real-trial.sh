#!/usr/bin/env bash
# Echtprobe des Release-Jobs: das VERÖFFENTLICHTE Produktions-Image (per Digest) mit dem frisch signierten Paket und den ECHTEN Schlüsseln. Das ist die einzige Stelle, an der das
# Produktionsbinary mit den echten Schlüsseln positiv getestet werden kann (vor dem Release gibt es kein Siegel). Scheitert sie, wird kein Release angelegt und kein
# Versions-Tag (latest, X.Y.Z, X.Y) gesetzt.
#
#   bash scripts/real-trial.sh <image@sha256:…> <version> <paketverzeichnis> <SOS-SEAL>
#
# Die Probe verlangt vom Starter im Image die Schnittstelle aus README „Starter-Vertrauensanker“ (Teil 2 des Pakets P1b-6):
#   /bootstrap --print-keys                        gibt "root <16 Hex>" und "release <16 Hex>" aus (Fingerabdrücke der einkompilierten Schlüssel)
#   /bootstrap --verify DIR --expect-version V [--no-floor] [--check-expiry JJJJ-MM-TT]
#                                                  prüft Siegel, Dateiliste und Baum; Exit-Code 0 = ok, 10–19 siehe README. --no-floor: Die Untergrenze (eingebaute Version)
#                                                  wird nur gemeldet, nicht erzwungen – das veröffentlichte Paket hat dieselbe Version wie das Image.
# Fehlt sie (ältere Images), schlägt die Probe fehl: Ohne Prüfer gibt es kein Release (fail closed), keine stille Ausnahme.
set -euo pipefail

image="${1:?Aufruf: scripts/real-trial.sh <image@digest> <version> <paketverzeichnis> <SOS-SEAL>}"
version="${2:?Version fehlt}"
bundle="${3:?Paketverzeichnis fehlt}"
seal="${4:?SOS-SEAL fehlt}"
cd "$(dirname "$0")/.."

fail() { echo "ECHTPROBE FEHLGESCHLAGEN: $*" >&2; exit 1; }

# Der Starter läuft ohne Netz, ohne Schreibzugriff und ohne Capabilities (wie im gehärteten Betrieb); /data nur lesend
starter() {
  docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --entrypoint /bootstrap "$@"
}

work="$(mktemp -d)"
trap 'chmod -R u+w "$work" 2>/dev/null || true; rm -rf "$work"' EXIT

echo "== 0. Referenzprüfer (Node) mit den echten Schlüsseln =="
node --no-warnings scripts/verify-tree.mjs "$bundle" --seal "$seal" --expect-version "$version" --no-floor --check-expiry "$(date -u +%F)" >/dev/null \
  || fail "Das Siegel besteht den Referenzprüfer nicht – so würde kein Anwender es installieren können."
echo "ok"

docker pull "$image" >/dev/null

echo "== 1. Schlüssel im Image =="
expected="$(node --no-warnings scripts/gen-trust-header.mjs --print-fingerprints 2>/dev/null)"
actual="$(starter "$image" --print-keys)" || fail "Der Starter des Images kennt --print-keys nicht (der Prüfer gehört zum Paket P1b-6, Teil 2) – ohne ihn gibt es keine Echtprobe und kein Release."
[ "$actual" = "$expected" ] || fail "Die Schlüssel im Image weichen vom Code ab."$'\n'"erwartet:"$'\n'"$expected"$'\n'"gefunden:"$'\n'"$actual"
# Negativprobe: ein Testschlüssel darf nie Vertrauensanker eines veröffentlichten Images sein
while read -r _ fingerprint; do
  echo "$actual" | grep -q " $fingerprint" && fail "Das Image enthält einen Testschlüssel ($fingerprint)."
done < <(node --no-warnings scripts/gen-trust-header.mjs --print-test-fingerprints)
echo "ok"

echo "== 2. Paket mit Siegel, geprüft vom Starter des Images =="
target="$work/app/versions/$version"
mkdir -p "$work/app/versions"
cp -a "$bundle" "$target"
cp "$seal" "$target/SOS-SEAL"
chmod -R a+rX "$work"
verify() { starter -v "$work:/data:ro" -e DATA_DIR=/data "$image" --verify "/data/app/versions/$version" --expect-version "$version" --no-floor --check-expiry "$(date -u +%F)"; }
verify >/dev/null || fail "Der Starter weist das frisch signierte Paket ab (Code $?)."
echo "ok"

echo "== 3. Manipulationen werden abgewiesen =="
expect() {
  local wanted="$1" what="$2" code=0
  verify >/dev/null 2>&1 || code=$?
  [ "$code" = "$wanted" ] || fail "$what: erwartet Code $wanted, war $code."
}
chmod -R u+w "$work"
echo "zusätzlich" > "$target/zusaetzlich.txt"; expect 15 "zusätzliche Datei"; rm -f "$target/zusaetzlich.txt"
mkdir -p "$work/app/versions/node_modules"; expect 18 "node_modules neben der Version"; rmdir "$work/app/versions/node_modules"
cp "$target/server.js" "$work/server.js.orig"; echo "// verändert" >> "$target/server.js"; expect 16 "veränderte Datei"; cp "$work/server.js.orig" "$target/server.js"
verify >/dev/null || fail "Nach dem Zurücksetzen der Manipulationen besteht das Paket nicht mehr."
echo "ok"

echo "Echtprobe bestanden."
