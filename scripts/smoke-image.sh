#!/usr/bin/env bash
# Smoke-Test des gebauten Images (läuft in der Pipeline vor dem Veröffentlichen; lokal mit Docker ebenso):
#
#   bash scripts/smoke-image.sh <lokales-image>   z. B. schrauberos:smoke
#
# Geprüft wird mit den ausgelieferten Compose-Dateien (docker-compose.yml, docker-compose.hardened.yml), nicht mit eigenen Docker-Aufrufen:
#   1. Das Image enthält die eingebaute App als root:root (nicht schreibbar für den Betriebsbenutzer, keine Gruppen-/Welt-Schreibrechte, kein Setuid/Setgid/Sticky) samt
#      Dateiliste SOS-TREE, die zum Baum passt (Referenzprüfer, wenn Node vorhanden ist); /data gehört dem Betriebsbenutzer.
#   2. Der Container wird gesund (Starter -> Launcher -> App, Migration, /api/health), die Anmeldeseite wird ausgeliefert, nicht Angemeldete
#      werden zur Anmeldung geleitet, die Antworten tragen die erzwungene Content-Security-Policy, die Programmierschnittstelle (/api/v1) antwortet
#      ohne Token mit 401 und der Upload von Sicherungen erreicht seine Route (401 ohne Sitzung).
#   3. Dasselbe mit der gehärteten Variante: read_only mit tmpfs, alle Capabilities entfernt, no-new-privileges.
set -euo pipefail

local_image="${1:?Aufruf: scripts/smoke-image.sh <lokales-image>}"
cd "$(dirname "$0")/.."

export APP_PORT="${SMOKE_PORT:-3300}"
export SCHRAUBEROS_VERSION="smoke-local"
project="so-smoke"
base_url="http://127.0.0.1:${APP_PORT}"
compose_image="$(docker compose -f docker-compose.yml config --images | head -n1)"

fail() { echo "SMOKE-TEST FEHLGESCHLAGEN: $*" >&2; exit 1; }

cleanup() {
  docker compose -p "$project" -f docker-compose.yml -f docker-compose.hardened.yml down -v --remove-orphans >/dev/null 2>&1 || true
  [ -z "${cid:-}" ] || docker rm -f "$cid" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Das lokal gebaute Image unter dem Namen anbieten, den die Compose-Datei erwartet (nur lokal, wird nie veröffentlicht)
docker tag "$local_image" "$compose_image"

echo "== 1. Besitzer im Image =="
cid="$(docker create "$compose_image")"
listing="$(docker export "$cid" | tar --numeric-owner -tvf -)"
# Alles unter app/ muss root gehören (Besitzer 0/…), nichts darf Betriebsbenutzer 1000 gehören
foreign="$(echo "$listing" | awk '$2 !~ /^0\// && $6 ~ /^app(\/|$)/ {print}' | head -n5)"
[ -z "$foreign" ] || fail "Dateien unter /app gehören nicht root:"$'\n'"$foreign"
echo "$listing" | awk '$6 == "app/server.js" || $6 == "app/version.json" || $6 == "app/launcher.mjs" || $6 == "app/SOS-TREE" {n++} END {exit n == 4 ? 0 : 1}' || fail "server.js, version.json, launcher.mjs oder SOS-TREE fehlen unter /app"
# Modus-Bits: nichts unter /app darf für Gruppe oder Andere schreibbar sein (g+w / o+w), und Setuid, Setgid und Sticky sind verboten (Symlinks haben keine eigenen Modi)
loose="$(echo "$listing" | awk '$6 ~ /^app(\/|$)/ && substr($1,1,1) != "l" && (substr($1,6,1) == "w" || substr($1,9,1) == "w" || substr($1,4,1) ~ /[sS]/ || substr($1,7,1) ~ /[sS]/ || substr($1,10,1) ~ /[tT]/) {print}' | head -n5)"
[ -z "$loose" ] || fail "Dateien unter /app sind für Gruppe/Andere schreibbar oder tragen Setuid/Setgid/Sticky:"$'\n'"$loose"
# Die Dateiliste gegen den echten Baum des Images (Mengengleichheit, wie der Starter sie prüft); setzt Node >= 24 voraus
if command -v node >/dev/null 2>&1 && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'; then
  tree_dir="$(mktemp -d)"
  docker cp "$cid:/app/." "$tree_dir"
  node --no-warnings scripts/verify-tree.mjs "$tree_dir" >/dev/null || { rm -rf "$tree_dir"; fail "SOS-TREE passt nicht zum Baum unter /app"; }
  rm -rf "$tree_dir"
else
  echo "Hinweis: Node >= 24 fehlt, die Dateiliste wird nicht gegen den Baum geprüft."
fi
echo "$listing" | awk '$6 ~ /^data\/?$/ && $2 == "1000/1000" {ok = 1} END {exit ok ? 0 : 1}' || fail "/data gehört nicht dem Betriebsbenutzer 1000"
# Wer das Wurzelverzeichnis ("/") oder den Starter (/bootstrap) ändern könnte, könnte den Vertrauensanker austauschen: beide gehören root und sind für Gruppe und Andere nicht schreibbar.
# (docker export nennt "/" nicht; docker cp "<Container>:/" liefert den Eintrag samt Besitzer und Modus.)
anchor_entries="$(docker cp "$cid:/" - 2>/dev/null | tar --numeric-owner -tvf - 2>/dev/null | awk '$6 == "/" || $6 == "/bootstrap" {print}')"
[ "$(echo "$anchor_entries" | grep -c .)" = "2" ] || fail "Der Eintrag für / oder /bootstrap fehlt im Image:"$'\n'"$anchor_entries"
bad_anchor="$(echo "$anchor_entries" | awk '$2 != "0/0" || substr($1,6,1) == "w" || substr($1,9,1) == "w" || substr($1,4,1) ~ /[sS]/ || substr($1,7,1) ~ /[sS]/ || substr($1,10,1) ~ /[tT]/ {print}')"
[ -z "$bad_anchor" ] || fail "/ oder /bootstrap gehört nicht root oder ist für Gruppe/Andere schreibbar:"$'\n'"$bad_anchor"
echo "$anchor_entries" | awk '$6 == "/bootstrap" && substr($1,1,1) == "-" && substr($1,4,1) == "x" {ok = 1} END {exit ok ? 0 : 1}' || fail "/bootstrap ist keine ausführbare reguläre Datei"
docker rm -f "$cid" >/dev/null && cid=""
echo "ok: /app ist root:root und nicht schreibbar, SOS-TREE passt, / und /bootstrap gehören root, /data gehört 1000:1000"

check_running() {
  local name="$1"; shift
  echo "== $name =="
  docker compose -p "$project" "$@" up -d --no-build --pull never --wait --wait-timeout 240 \
    || { docker compose -p "$project" "$@" logs --no-color | tail -n 80 >&2; fail "$name: Container wird nicht gesund"; }

  health="$(curl -fsS "${base_url}/api/health")" || fail "$name: /api/health nicht erreichbar"
  echo "$health" | grep -q '"status":"ok"' || fail "$name: /api/health meldet nicht ok: $health"

  login_headers="$(curl -sS -D - -o /dev/null "${base_url}/login")" || fail "$name: /login nicht erreichbar"
  echo "$login_headers" | head -n1 | grep -q " 200" || fail "$name: /login liefert nicht 200"
  echo "$login_headers" | grep -iq "^content-security-policy:.*default-src 'self'" || fail "$name: /login ohne erzwungene Content-Security-Policy"
  echo "$login_headers" | grep -iq "^x-content-type-options: nosniff" || fail "$name: nosniff fehlt"
  echo "$login_headers" | grep -iq "report-only" && fail "$name: die Content-Security-Policy darf nicht nur melden"

  root_status="$(curl -sS -o /dev/null -w '%{http_code}' "${base_url}/")"
  case "$root_status" in 302|303|307|308) ;; *) fail "$name: / ohne Anmeldung sollte weiterleiten, war $root_status" ;; esac

  # Programmierschnittstelle: ohne Token (und mit falschem) ist alles 401 im Problem-Format – prüft Route, Proxy und Fehlerformat im gebauten Image
  api_headers="$(curl -sS -D - -o /dev/null "${base_url}/api/v1/customers")" || fail "$name: /api/v1/customers nicht erreichbar"
  echo "$api_headers" | head -n1 | grep -q " 401" || fail "$name: /api/v1/customers ohne Token sollte 401 liefern: $(echo "$api_headers" | head -n1)"
  echo "$api_headers" | grep -iq "^content-type: application/problem+json" || fail "$name: /api/v1 antwortet nicht im Problem-Format"
  api_bad="$(curl -sS -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer sos_ungueltig' "${base_url}/api/v1/customers")"
  [ "$api_bad" = "401" ] || fail "$name: /api/v1/customers mit ungültigem Token sollte 401 liefern, war $api_bad"
  # Upload von Sicherungen läuft nicht durch den Proxy (Body-Puffer 10 MiB): ohne Sitzung beantwortet die Route selbst mit 401 (und nicht der Proxy mit einer Weiterleitung)
  upload_status="$(curl -sS -o /dev/null -w '%{http_code}' -X POST --data-binary 'x' "${base_url}/api/backups/upload")"
  [ "$upload_status" = "401" ] || fail "$name: POST /api/backups/upload ohne Sitzung sollte 401 liefern, war $upload_status"

  # Die App hat in /data geschrieben (Datenbank, Einrichtungs-Token) – auch mit schreibgeschütztem Wurzeldateisystem
  docker compose -p "$project" "$@" logs --no-color app | grep -q "Einrichtungs-Token" || fail "$name: kein Einrichtungs-Token im Log (Einrichtung nicht gestartet?)"
  echo "ok: $name"
}

check_running "2. Standard (docker-compose.yml)" -f docker-compose.yml
docker compose -p "$project" -f docker-compose.yml down -v --remove-orphans >/dev/null

check_running "3. Gehärtet (docker-compose.hardened.yml)" -f docker-compose.yml -f docker-compose.hardened.yml
container="$(docker compose -p "$project" -f docker-compose.yml -f docker-compose.hardened.yml ps -q app)"
inspected="$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}} {{.HostConfig.SecurityOpt}}' "$container")"
echo "$inspected" | grep -q "^true " || fail "gehärtet: Wurzeldateisystem ist nicht schreibgeschützt ($inspected)"
echo "$inspected" | grep -qi "all" || fail "gehärtet: Capabilities nicht entfernt ($inspected)"
echo "$inspected" | grep -q "no-new-privileges" || fail "gehärtet: no-new-privileges fehlt ($inspected)"

echo "Smoke-Test bestanden."
