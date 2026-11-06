#!/usr/bin/env bash
# Smoke-Test des gebauten Images (läuft in der Pipeline vor dem Veröffentlichen; lokal mit Docker ebenso):
#
#   bash scripts/smoke-image.sh <lokales-image>   z. B. schrauberos:smoke
#
# Geprüft wird mit den ausgelieferten Compose-Dateien (docker-compose.yml, docker-compose.hardened.yml), nicht mit eigenen Docker-Aufrufen:
#   1. Das Image enthält die eingebaute App als root:root (nicht schreibbar für den Betriebsbenutzer); /data gehört dem Betriebsbenutzer.
#   2. Der Container wird gesund (Starter -> Launcher -> App, Migration, /api/health), die Anmeldeseite wird ausgeliefert, nicht Angemeldete
#      werden zur Anmeldung geleitet und die Antworten tragen die erzwungene Content-Security-Policy.
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
echo "$listing" | awk '$6 == "app/server.js" || $6 == "app/version.json" || $6 == "app/launcher.mjs" {n++} END {exit n == 3 ? 0 : 1}' || fail "server.js, version.json oder launcher.mjs fehlen unter /app"
echo "$listing" | awk '$6 ~ /^data\/?$/ && $2 == "1000/1000" {ok = 1} END {exit ok ? 0 : 1}' || fail "/data gehört nicht dem Betriebsbenutzer 1000"
docker rm -f "$cid" >/dev/null && cid=""
echo "ok: /app ist root:root, /data gehört 1000:1000"

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
