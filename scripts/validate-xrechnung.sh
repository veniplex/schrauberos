#!/usr/bin/env bash
# Prüft E-Rechnungs-XML (XRechnung / EN 16931, UBL und CII) gegen den KoSIT-Prüfer (https://github.com/itplr-kosit/validator).
#
#   scripts/validate-xrechnung.sh <Ordner mit XML-Beispielen> [Arbeitsordner]
#
# Aufruf aus der Pipeline (Job "xrechnung" in .github/workflows/docker-publish.yml) und lokal (braucht Java 11 oder neuer, curl, unzip, sha256sum).
# Die Beispiele schreiben die Tests der Rechnungserstellung (F3) über `writeEinvoiceSample` (src/test/einvoice-samples.ts) in den Ordner, den `EINVOICE_SAMPLES_DIR` nennt.
# Solange es noch keine Beispiele gibt (Gerüst vor F3), meldet das Skript das und endet erfolgreich; mit XRECHNUNG_REQUIRE_SAMPLES=1 ist ein leerer Ordner ein Fehler
# (dann gehört die Prüfung zum Gate der Rechnungserstellung).
#
# Versionen UND Prüfsummen sind festgelegt (keine beweglichen Versionen): Ein anderer Stand des Prüfers oder der Prüfregeln ist eine bewusste Änderung in diesem Skript. Die Prüfsummen stammen aus den
# Release-Angaben von GitHub (Feld "digest" der Release-Dateien); der Download wird vor dem Start gegen sie geprüft, bei Abweichung bricht das Skript ab.
set -euo pipefail

VALIDATOR_VERSION="1.6.3"
VALIDATOR_URL="https://github.com/itplr-kosit/validator/releases/download/v${VALIDATOR_VERSION}/validator-${VALIDATOR_VERSION}-standalone.jar"
VALIDATOR_SHA256="799e64befca97d4080e03608c80b85dd5a5ecc5f4ae4f35d1116ec2855b9a7c9"

CONFIG_TAG="v2026-08-31"
CONFIG_ZIP="xrechnung-3.0.2-validator-configuration-2026-08-31.zip"
CONFIG_URL="https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/${CONFIG_TAG}/${CONFIG_ZIP}"
CONFIG_SHA256="2530cd107c414511c5d0462ec10f886910395abfca820db82e83d70bf01221a8"

samples="${1:?Aufruf: scripts/validate-xrechnung.sh <Ordner mit XML-Beispielen> [Arbeitsordner]}"
work="${2:-$(mktemp -d)}"

shopt -s nullglob
files=("$samples"/*.xml)
if [ "${#files[@]}" -eq 0 ]; then
  if [ "${XRECHNUNG_REQUIRE_SAMPLES:-0}" = "1" ]; then
    echo "Keine XML-Beispiele in $samples, obwohl XRECHNUNG_REQUIRE_SAMPLES=1 gilt." >&2
    exit 1
  fi
  echo "Keine XML-Beispiele in $samples: Gerüst ohne Prüfung (die Rechnungserstellung F3 liefert sie)."
  exit 0
fi

command -v java >/dev/null || { echo "Java fehlt (ab Version 11 nötig)." >&2; exit 1; }
mkdir -p "$work"

verify() { # <Datei> <SHA-256>: bricht ab und verwirft die Datei, wenn die Prüfsumme nicht stimmt
  echo "$2  $1" | sha256sum --check --strict --quiet || { echo "Prüfsumme von $(basename "$1") stimmt nicht – Datei verworfen." >&2; rm -f "$1"; exit 1; }
}

fetch() { # <Adresse> <Datei> <SHA-256>: nur HTTPS (auch bei Weiterleitungen), danach Prüfsumme
  curl --fail --location --proto '=https' --proto-redir '=https' --silent --show-error --retry 3 --output "$2" "$1"
  verify "$2" "$3"
}

# Eine schon vorhandene Datei im Arbeitsordner wird nur benutzt, wenn ihre Prüfsumme stimmt (sonst neu geladen)
ensure() { # <Adresse> <Datei> <SHA-256>
  if [ -f "$2" ] && echo "$3  $2" | sha256sum --check --strict --quiet 2>/dev/null; then return 0; fi
  rm -f "$2"
  fetch "$1" "$2" "$3"
}

jar="$work/validator-${VALIDATOR_VERSION}-standalone.jar"
config_zip="$work/$CONFIG_ZIP"
ensure "$VALIDATOR_URL" "$jar" "$VALIDATOR_SHA256"
ensure "$CONFIG_URL" "$config_zip" "$CONFIG_SHA256"

rm -rf "$work/config" "$work/out"
mkdir -p "$work/config" "$work/out"
unzip -q "$config_zip" -d "$work/config"
scenarios="$(find "$work/config" -name scenarios.xml -print -quit)"
[ -n "$scenarios" ] || { echo "scenarios.xml fehlt in der Prüfkonfiguration." >&2; exit 1; }

echo "Prüfe ${#files[@]} Datei(en) mit KoSIT-Prüfer ${VALIDATOR_VERSION} und Konfiguration ${CONFIG_TAG}"
# Der Prüfer endet mit einem Wert ungleich 0, wenn eine Datei abgelehnt wurde; die Berichte (XML und HTML) liegen in $work/out
java -jar "$jar" -s "$scenarios" -r "$(dirname "$scenarios")" -o "$work/out" "${files[@]}"
echo "Alle Beispiele wurden angenommen. Berichte: $work/out"
