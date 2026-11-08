#!/usr/bin/env bash
# Probeläufe des Starters im echten Container über das Smoke-Skript hinaus (Block 13c, nur lokal, nur mit Testschlüsseln):
#
#   bash scripts/starter-trial.sh <image-mit-testschluesseln> <docker-volume-mit-releases>
#
# Das Image muss die TESTSCHLÜSSEL tragen (Ziel runner-test; ein Image mit echten Schlüsseln weist das Skript ab). Das Volume enthält unter `rel/` die Testreleases von
# scripts/trial-release.mjs (`0.1.4-chain` = Siegel mit beglaubigtem Schlüssel, `0.1.9-expired` = Siegel mit inzwischen abgelaufener Beglaubigung). Je Szenario ein frisches
# Datenvolume mit installiertem Paket wie nach einem Web-Update (root-eigen im Paket gibt es nicht: die App schreibt als uid 1000, der Installer setzt Schreibschutz), eine Manipulation,
# Start des Containers (gehärtet: read_only, cap_drop ALL, no-new-privileges), dann die Erwartung (Log des Starters, state.json, Gesundheit, kein Neustart-Kreis).
# Ergänzt scripts/smoke-anchor.sh (das die Grundfälle macht) um: abgelaufene Beglaubigung (Starter prüft den Ablauf nie), manipulierte Beglaubigung/Siegel,
# Marker- und Zeigerdateien als Verzeichnis (Boot-Schleife?), Setgid/Setuid/FIFO im Baum, `.blocked-*`-Reste, ein Volume mit fremder Migrationshistorie („Neuinstallation nötig“).
set -euo pipefail

image="${1:?Aufruf: scripts/starter-trial.sh <image-mit-testschluesseln> <docker-volume-mit-releases>}"
work="${2:?Docker-Volume mit rel/<release> fehlt}"
cd "$(dirname "$0")/.."

port="${TRIAL_PORT:-3530}"
helper="${SMOKE_HELPER_IMAGE:-alpine:3.20}"
base_url="http://127.0.0.1:${port}"
name="so-trial"
volumes=()
failures=0

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  for v in "${volumes[@]:-}"; do [ -z "$v" ] || docker volume rm -f "$v" >/dev/null 2>&1 || true; done
}
trap cleanup EXIT

note() { echo "$*"; }
bad() { echo "FEHLER: $*" >&2; failures=$((failures + 1)); }

vol_sh() { local volume="$1"; shift; docker run --rm -v "$volume:/data" -v "$work:/work:ro" "$helper" sh -c "$*"; }

echo "== 0. Das Image trägt die Testschlüssel =="
expected="$(node --no-warnings scripts/gen-trust-header.mjs --print-test-fingerprints | awk '{print $2}')"
actual="$(docker run --rm --entrypoint /bootstrap "$image" --print-keys)"
[ "$(echo "$actual" | awk '$1 == "root" {print $2}')" = "$(echo "$expected" | sed -n 1p)" ] || { echo "Kein Testschlüssel-Image – Abbruch." >&2; exit 1; }
[ "$(echo "$actual" | awk '$1 == "tag-build" {print $2}')" = "0" ] || { echo "Ein Tag-Build ist kein Testschlüssel-Image – Abbruch." >&2; exit 1; }
echo "ok"

# make_volume <release-ordner-im-volume> <version> → Volume mit installiertem Paket, Zeiger und Zustand
make_volume() {
  local rel="$1" ver="$2" vol="so-trial-$RANDOM$RANDOM"
  docker volume create "$vol" >/dev/null
  volumes+=("$vol")
  vol_sh "$vol" "mkdir -p /data/app/versions/$ver && tar xzf /work/rel/$rel/schrauberos-$ver.tar.gz -C /data/app/versions/$ver && cp /work/rel/$rel/SOS-SEAL /data/app/versions/$ver/SOS-SEAL && printf '%s' /data/app/versions/$ver > /data/app/active && printf '{\"schema\":1,\"current\":\"$ver\",\"previous\":null,\"pending\":false,\"failed\":[],\"last\":null,\"inconclusive\":null}' > /data/app/state.json && chown -R 1000:1000 /data && chmod -R a-w /data/app/versions/$ver && chmod u+w /data /data/app" >/dev/null
  echo "$vol"
}

start() { # start <volume> [docker-Optionen …]; wartet auf Gesundheit
  local vol="$1"; shift
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" -p "${port}:3000" -v "$vol:/data" --read-only --tmpfs /tmp:size=64m,mode=1777 --cap-drop ALL --security-opt no-new-privileges "$@" "$image" >/dev/null
  local waited=0
  until curl -fsS "${base_url}/api/health" 2>/dev/null | grep -q '"status":"ok"'; do
    sleep 2; waited=$((waited + 2))
    if [ "$waited" -ge 90 ] || [ "$(docker inspect -f '{{.State.Running}}' "$name")" != "true" ]; then return 1; fi
  done
}
has_log() { local out; out="$(docker logs "$name" 2>&1)"; grep -q -- "$1" <<<"$out"; }
restarts() { docker inspect -f '{{.RestartCount}}' "$name"; }
state_json() { docker cp "$name:/data/app/state.json" - 2>/dev/null | tar -xO 2>/dev/null || true; }

scenario() { # scenario <Titel> <Volume> <erwartete Logzeile> <welche Version läuft: builtin|<version>>
  local title="$1" vol="$2" pattern="$3" runs="$4"
  if ! start "$vol"; then bad "$title: die App wird nicht gesund"; docker logs "$name" 2>&1 | tail -n 15 >&2; return; fi
  has_log "$pattern" || { bad "$title: erwartete Logzeile fehlt: $pattern"; docker logs "$name" 2>&1 | grep bootstrap | tail -n 8 >&2; }
  if [ "$runs" = builtin ]; then has_log "Starte Launcher aus /app" || bad "$title: die eingebaute Version läuft nicht"; else has_log "Starte Launcher aus /data/app/versions/$runs" || bad "$title: Version $runs läuft nicht"; fi
  docker exec "$name" /bootstrap --healthcheck >/dev/null 2>&1 || bad "$title: Healthcheck schlägt fehl"
  [ "$(restarts)" = "0" ] || bad "$title: der Container wurde $(restarts)-mal neu gestartet (Boot-Schleife?)"
  note "ok: $title"
  docker rm -f "$name" >/dev/null
}

# ───── 1. Abgelaufene Beglaubigung: der Starter prüft den Ablauf nie ─────
echo "== 1. Siegel mit abgelaufener Beglaubigung: Starter startet die Version (nur die App prüft den Ablauf beim Installieren) =="
vol="$(make_volume 0.1.9-expired 0.1.9)"
scenario "abgelaufene Beglaubigung" "$vol" "Version 0.1.9 geprüft" 0.1.9

# ───── 2. Manipulierte Beglaubigung / Siegel ─────
echo "== 2. Manipulierte Beglaubigung und Siegel =="
vol="$(make_volume 0.1.4-chain 0.1.4)"
vol_sh "$vol" "chmod u+w /data/app/versions/0.1.4 /data/app/versions/0.1.4/SOS-SEAL && sed -i 's/^\(endorsement-sig [0-9a-f]*\)[0-9a-f]\$/\1X/' /data/app/versions/0.1.4/SOS-SEAL" >/dev/null
scenario "Beglaubigungs-Signatur verändert" "$vol" "abgelehnt (Code 1[01]" builtin
vol="$(make_volume 0.1.4-chain 0.1.4)"
vol_sh "$vol" "chmod u+w /data/app/versions/0.1.4 /data/app/versions/0.1.4/SOS-SEAL && sed -i 's/^tree-bytes [0-9]*/tree-bytes 1/' /data/app/versions/0.1.4/SOS-SEAL" >/dev/null
scenario "Siegel-Rumpf verändert (tree-bytes)" "$vol" "abgelaufen\|abgelehnt (Code 1[01]" builtin
vol="$(make_volume 0.1.4-chain 0.1.4)"
vol_sh "$vol" "chmod u+w /data/app/versions/0.1.4 /data/app/versions/0.1.4/SOS-SEAL && head -c 200 /data/app/versions/0.1.4/SOS-SEAL > /data/app/versions/0.1.4/SOS-SEAL.new && mv /data/app/versions/0.1.4/SOS-SEAL.new /data/app/versions/0.1.4/SOS-SEAL" >/dev/null
scenario "Siegel abgeschnitten" "$vol" "abgelehnt (Code 1[01]" builtin

# ───── 3. Sonderdateien und Setid im Baum ─────
echo "== 3. Sonderdateien, Setgid, Setuid =="
vol="$(make_volume 0.1.4-chain 0.1.4)"
vol_sh "$vol" "chmod -R u+w /data/app/versions/0.1.4 && chmod g+s /data/app/versions/0.1.4/server.js" >/dev/null
scenario "Setgid an einer Datei" "$vol" "abgelehnt (Code 16" builtin
vol="$(make_volume 0.1.4-chain 0.1.4)"
vol_sh "$vol" "chmod -R u+w /data/app/versions/0.1.4 && chmod g+s /data/app/versions/0.1.4/public" >/dev/null
scenario "Setgid an einem Ordner" "$vol" "abgelehnt (Code 16" builtin
vol="$(make_volume 0.1.4-chain 0.1.4)"
vol_sh "$vol" "chmod -R u+w /data/app/versions/0.1.4 && chmod u+s /data/app/versions/0.1.4/runtime/node" >/dev/null
scenario "Setuid an node" "$vol" "abgelehnt (Code 16" builtin
vol="$(make_volume 0.1.4-chain 0.1.4)"
vol_sh "$vol" "chmod -R u+w /data/app/versions/0.1.4 && mkfifo /data/app/versions/0.1.4/public/fifo" >/dev/null
scenario "FIFO im Baum" "$vol" "abgelehnt (Code 1[456]" builtin

# ───── 4. Marker- und Zeigerdateien als Verzeichnis ─────
echo "== 4. Marker, Zeiger und Zustand als Verzeichnis (kein Absturz, keine Boot-Schleife) =="
for marker in verify-failed inconclusive verify-ok launcher-crash incompatible integrity-reported; do
  vol="$(make_volume 0.1.4-chain 0.1.4)"
  vol_sh "$vol" "chmod -R u+w /data/app/versions/0.1.4 && printf x >> /data/app/versions/0.1.4/server.js && mkdir -p /data/app/$marker/inner && printf secret > /data/app/$marker/inner/datei && chown -R 1000:1000 /data/app" >/dev/null
  scenario "Marker $marker als Verzeichnis (bei veränderter Version, der Starter will den Marker schreiben)" "$vol" "abgelehnt (Code 16" builtin
done
vol="$(make_volume 0.1.4-chain 0.1.4)"
vol_sh "$vol" "rm /data/app/state.json && mkdir /data/app/state.json && printf x > /data/app/state.json/datei && chown -R 1000:1000 /data/app" >/dev/null
scenario "state.json als Verzeichnis" "$vol" "Starte Launcher" 0.1.4
vol="$(make_volume 0.1.4-chain 0.1.4)"
vol_sh "$vol" "rm /data/app/active && mkdir /data/app/active && chown -R 1000:1000 /data/app" >/dev/null
scenario "Zeiger active als Verzeichnis" "$vol" "Starte Launcher aus /app" builtin
vol="$(make_volume 0.1.4-chain 0.1.4)"
vol_sh "$vol" "printf '%s' /etc > /data/app/active" >/dev/null
scenario "Zeiger active auf ein fremdes Verzeichnis (/etc)" "$vol" "Starte Launcher aus /app" builtin

# ───── 5. .blocked-*-Reste ─────
echo "== 5. Reste .blocked-* unter /data/app =="
vol="$(make_volume 0.1.4-chain 0.1.4)"
vol_sh "$vol" "mkdir -p /data/app/verify-failed.blocked-1 /data/app/.blocked-2 && printf x > /data/app/verify-failed.blocked-1/a && chown -R 1000:1000 /data/app" >/dev/null
scenario "vorhandene .blocked-Reste stören den Start nicht" "$vol" "Version 0.1.4 geprüft" 0.1.4
docker run --rm -v "$vol:/data" "$helper" sh -c 'ls -A /data/app | tr "\n" " "; echo' | sed 's/^/Inhalt von \/data\/app: /'

# ───── 6. Altes 0.1.0-Volume: fremde Migrationshistorie ─────
echo "== 6. Volume mit fremder Migrationshistorie (0.1.0-artig): „Neuinstallation nötig“ =="
vol="so-trial-$RANDOM$RANDOM"; docker volume create "$vol" >/dev/null; volumes+=("$vol")
docker run --rm -v "$vol:/data" "$helper" sh -c "apk add --no-cache sqlite >/dev/null 2>&1 && sqlite3 /data/schrauberos.db \"CREATE TABLE _prisma_migrations (id TEXT PRIMARY KEY NOT NULL, checksum TEXT NOT NULL, finished_at DATETIME, migration_name TEXT NOT NULL, logs TEXT, rolled_back_at DATETIME, started_at DATETIME NOT NULL DEFAULT current_timestamp, applied_steps_count INTEGER NOT NULL DEFAULT 0); INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count) VALUES ('a','x',current_timestamp,'20251101120000_init',1),('b','y',current_timestamp,'20251105090000_tires',1); CREATE TABLE User (id TEXT PRIMARY KEY, username TEXT);\" && chown -R 1000:1000 /data"
docker rm -f "$name" >/dev/null 2>&1 || true
docker run -d --name "$name" -p "${port}:3000" -v "$vol:/data" --read-only --tmpfs /tmp:size=64m,mode=1777 --cap-drop ALL --security-opt no-new-privileges "$image" >/dev/null
waited=0; until curl -fsS "${base_url}/api/health" >/dev/null 2>&1 || [ "$waited" -ge 40 ]; do sleep 2; waited=$((waited + 2)); done
health="$(curl -sS "${base_url}/api/health" || true)"
login_status="$(curl -sS -H 'Accept: text/html' -o /tmp/so-trial-login.html -w '%{http_code}' "${base_url}/login" || true)"
echo "health: $health | /login: HTTP $login_status | Meldung im Log: $(docker logs "$name" 2>&1 | grep -c 'Neuinstallation nötig') | Neustarts: $(restarts)"
[ "$login_status" = "503" ] || bad "/login sollte 503 liefern, war $login_status"
if grep -q "Neuinstallation" /tmp/so-trial-login.html 2>/dev/null; then note "ok: /login zeigt „Neuinstallation nötig“ (503)"; else bad "/login zeigt den Neuinstallations-Hinweis nicht"; fi
echo "$health" | grep -q '"status":"reinstall"' || bad "/api/health meldet nicht reinstall: $health"
[ "$(restarts)" = "0" ] || bad "Neustarts: $(restarts) (Boot-Schleife?)"
docker exec "$name" /bootstrap --healthcheck >/dev/null 2>&1 && note "Healthcheck des Containers: gesund" || note "Healthcheck des Containers: ungesund (erwartet bei „Neuinstallation nötig“?)"
docker rm -f "$name" >/dev/null

[ "$failures" -eq 0 ] && echo "Starter-Probeläufe bestanden." || { echo "$failures Fehler." >&2; exit 1; }
