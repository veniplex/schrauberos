#!/usr/bin/env bash
# Stufe L3 des Starter-Vertrauensankers (README „Starter-Vertrauensanker“, Abschnitt Tests): der Starter im echten Container, mit der echten App.
#
#   docker build --target runner-test -t schrauberos:anchor-test .
#   bash scripts/smoke-anchor.sh schrauberos:anchor-test
#
# Das Image muss die TESTSCHLÜSSEL tragen (Dockerfile-Ziel runner-test; ein veröffentlichtes Image weist das Skript ab). Aus dem Image wird ein Testpaket abgeleitet
# (docker cp /app, höhere Patch-Version, Dateiliste neu, Siegel mit dem Testschlüssel; docker/test/make-test-package.mjs) und in frische Volumes gelegt. Je Lauf eine Manipulation:
# Der Starter muss sie ablehnen, die eingebaute Version muss gesund laufen, state.json muss den Befund tragen. Der Gutfall prüft zusätzlich, dass typische Aufrufe der App
# nichts ins Paket schreiben (Nachprüfung mit `/bootstrap --verify` auf der laufenden Kopie) und läuft einmal gehärtet (read_only, cap_drop ALL, no-new-privileges).
# Braucht Docker, Node >= 24 (Testpaket) und ein kleines Hilfsimage (alpine) für Dateioperationen im Volume. Dauer: je Lauf 20–40 s, insgesamt etwa 6–8 Minuten.
set -euo pipefail

image="${1:?Aufruf: scripts/smoke-anchor.sh <image-mit-testschluesseln>}"
cd "$(dirname "$0")/.."

port="${SMOKE_PORT:-3310}"
helper="${SMOKE_HELPER_IMAGE:-alpine:3.20}"
base_url="http://127.0.0.1:${port}"
work="$(mktemp -d)"
name="so-anchor"
volumes=()

fail() { echo "SMOKE-ANCHOR FEHLGESCHLAGEN: $*" >&2; exit 1; }

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  for v in "${volumes[@]:-}"; do [ -z "$v" ] || docker volume rm -f "$v" >/dev/null 2>&1 || true; done
  chmod -R u+w "$work" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

# Dateioperationen im Volume als root (das Image selbst hat keine Shell)
vol_sh() { local volume="$1"; shift; docker run --rm -v "$volume:/data" "$helper" sh -c "$*"; }

echo "== 0. Das Image trägt die Testschlüssel =="
expected="$(node --no-warnings scripts/gen-trust-header.mjs --print-test-fingerprints | awk '{print $2}')"
actual="$(docker run --rm --entrypoint /bootstrap "$image" --print-keys)" || fail "Das Image kennt /bootstrap --print-keys nicht."
[ "$(echo "$actual" | awk '$1 == "root" {print $2}')" = "$(echo "$expected" | sed -n 1p)" ] || fail "Der Wurzelschlüssel im Image ist kein Testschlüssel – dieses Skript prüft nur Testschlüssel-Images (Ziel runner-test)."
[ "$(echo "$actual" | awk '$1 == "release" {print $2}')" = "$(echo "$expected" | sed -n 2p)" ] || fail "Der Release-Schlüssel im Image ist kein Testschlüssel."
echo "ok"

echo "== 1. Testpaket aus dem Image ableiten =="
cid="$(docker create "$image")"
mkdir -p "$work/builtin"
docker cp "$cid:/app/." "$work/builtin"
docker rm "$cid" >/dev/null
builtin_version="$(node -p 'require(process.argv[1]).version' "$work/builtin/version.json")"
version="$(node -e 'const v = process.argv[1].split("-")[0].split(".").map(Number); console.log(`${v[0]}.${v[1]}.${v[2] + 1}`)' "$builtin_version")"
older="$(node -e 'const v = process.argv[1].split("-")[0].split(".").map(Number); console.log(v[2] > 0 ? `${v[0]}.${v[1]}.${v[2] - 1}` : `${v[0]}.${Math.max(v[1] - 1, 0)}.0`)' "$builtin_version")"
make_package() { # make_package <ziel> <version> [weitere Optionen]
  local target="$1"; shift
  rm -rf "$target"; mkdir -p "$target"
  cp -a "$work/builtin/." "$target/"
  node --no-warnings docker/test/make-test-package.mjs "$target" --version "$@"
}
make_package "$work/pkg" "$version" >/dev/null
echo "ok: eingebaut $builtin_version, Testpaket $version"

# Ein Volume mit Paket, Zeiger und Zustand anlegen; Name auf stdout
make_volume() { # make_volume <paketverzeichnis> <version>
  local pkg="$1" ver="$2" vol="so-anchor-$RANDOM$RANDOM"
  docker volume create "$vol" >/dev/null
  volumes+=("$vol")
  vol_sh "$vol" "mkdir -p /data/app/versions" >/dev/null
  local c
  c="$(docker create -v "$vol:/data" "$helper" true)"
  docker cp "$pkg/." "$c:/data/app/versions/$ver" >/dev/null
  docker rm "$c" >/dev/null
  vol_sh "$vol" "printf '%s' /data/app/versions/$ver > /data/app/active && printf '{\"schema\":1,\"current\":\"$ver\",\"previous\":null,\"pending\":false,\"failed\":[],\"last\":null,\"inconclusive\":null}' > /data/app/state.json && chown -R 1000:1000 /data && chmod -R a-w /data/app/versions/$ver && chmod u+w /data /data/app" >/dev/null
  echo "$vol"
}

start() { # start <volume> [docker-Optionen …]
  local vol="$1"; shift
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" -p "${port}:3000" -v "$vol:/data" "$@" "$image" >/dev/null
  local waited=0
  until curl -fsS "${base_url}/api/health" 2>/dev/null | grep -q '"status":"ok"'; do
    sleep 2; waited=$((waited + 2))
    [ "$waited" -lt 240 ] || { docker logs "$name" 2>&1 | tail -n 60 >&2; fail "Die App wird nicht gesund."; }
    [ "$(docker inspect -f '{{.State.Running}}' "$name")" = "true" ] || { docker logs "$name" 2>&1 | tail -n 60 >&2; fail "Der Container läuft nicht mehr."; }
  done
}

logs() { docker logs "$name" 2>&1; }
state_json() { docker cp "$name:/data/app/state.json" - | tar -xO 2>/dev/null; }

# ───── Gutfall ─────
run_happy() { # run_happy <Titel> [docker-Optionen …]
  local title="$1"; shift
  echo "== $title =="
  local vol; vol="$(make_volume "$work/pkg" "$version")"
  start "$vol" "$@"
  logs | grep -q "Version $version geprüft" || fail "$title: keine Erfolgszeile des Prüfers im Log."
  logs | grep -q "Starte Launcher aus /data/app/versions/$version" || fail "$title: nicht die installierte Version gestartet."
  # typische Aufrufe: nichts davon darf ins Paket schreiben
  for path in / /login /api/health "/_next/image?url=%2Ffavicon.ico&w=64&q=75" /favicon.ico "/_next/static/none.js"; do curl -sS -o /dev/null "${base_url}${path}" || true; done
  docker run --rm -v "$vol:/data:ro" -e DATA_DIR=/data --entrypoint /bootstrap "$image" --verify "/data/app/versions/$version" --expect-version "$version" >/dev/null \
    || fail "$title: Nach den Aufrufen besteht die laufende Kopie die Prüfung nicht mehr (die App hat ins Paket geschrieben)."
  docker rm -f "$name" >/dev/null
  echo "ok"
}

run_happy "2. Gutfall (Standard)"
run_happy "3. Gutfall (gehärtet: read_only, cap_drop ALL, no-new-privileges)" --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,mode=1777

# ───── Manipulationen: je Lauf eine ─────
run_rejected() { # run_rejected <Titel> <erwarteter Code> <Volume>
  local title="$1" code="$2" vol="$3"
  start "$vol"
  logs | grep -q "abgelehnt (Code $code" || { logs | tail -n 30 >&2; fail "$title: erwartet wurde die Ablehnung mit Code $code."; }
  logs | grep -q "Starte Launcher aus /app" || fail "$title: die eingebaute Version wurde nicht gestartet."
  state_json | grep -q "integrity:$code" || { state_json >&2 || true; fail "$title: state.json trägt den Befund integrity:$code nicht."; }
  docker exec "$name" /bootstrap --healthcheck >/dev/null 2>&1 || fail "$title: Healthcheck schlägt fehl."
  docker rm -f "$name" >/dev/null
  echo "ok: $title -> Code $code, eingebaute Version läuft"
}

echo "== 4. Manipulationen werden abgelehnt =="
vol="$(make_volume "$work/pkg" "$version")"
vol_sh "$vol" "touch /data/app/versions/$version/zusaetzlich.txt" >/dev/null
run_rejected "zusätzliche Datei" 15 "$vol"

vol="$(make_volume "$work/pkg" "$version")"
vol_sh "$vol" "f=\$(find /data/app/versions/$version/.next/server -name '*.js' -type f | head -n1) && printf 'x' >> \"\$f\"" >/dev/null
run_rejected "veränderte Datei in .next/server" 16 "$vol"

vol="$(make_volume "$work/pkg" "$version")"
vol_sh "$vol" "chmod a-x /data/app/versions/$version/runtime/node" >/dev/null
run_rejected "Ausführbit entzogen" 16 "$vol"

vol="$(make_volume "$work/pkg" "$version")"
vol_sh "$vol" "l=\$(find /data/app/versions/$version/.next -type l | head -n1) && test -n \"\$l\" && rm \"\$l\" && ln -s /etc \"\$l\"" >/dev/null
run_rejected "Symlink umgebogen" 16 "$vol"

vol="$(make_volume "$work/pkg" "$version")"
vol_sh "$vol" "rm /data/app/versions/$version/SOS-SEAL" >/dev/null
run_rejected "Siegel fehlt" 10 "$vol"

vol="$(make_volume "$work/pkg" "$version")"
vol_sh "$vol" "mkdir /data/app/versions/node_modules" >/dev/null
run_rejected "node_modules neben der Version" 18 "$vol"

make_package "$work/relabel" "$version" --seal-version "$older" >/dev/null
vol="$(make_volume "$work/relabel" "$version")"
run_rejected "Siegel einer anderen Version" 12 "$vol"

echo "== 5. Veraltete Version (unter der Untergrenze): keine Marke, kein Alarm =="
make_package "$work/old" "$older" >/dev/null
vol="$(make_volume "$work/old" "$older")"
start "$vol"
logs | grep -q "veraltet oder passt nicht" || fail "Die veraltete Version wurde nicht als veraltet gemeldet."
logs | grep -q "Starte Launcher aus /app" || fail "Die eingebaute Version läuft nicht."
state_json | grep -q "integrity" && fail "Eine veraltete Version darf keinen Integritätsbefund hinterlassen."
docker rm -f "$name" >/dev/null
echo "ok"

echo "== 6. Neustart nach Manipulation geht über den Starter =="
vol="$(make_volume "$work/pkg" "$version")"
start "$vol"
logs | grep -q "Version $version geprüft" || fail "Der Gutfall lief nicht an."
vol_sh "$vol" "chmod u+w /data/app/versions/$version/server.js && printf 'x' >> /data/app/versions/$version/server.js" >/dev/null
docker restart -t 30 "$name" >/dev/null
waited=0
until logs | grep -q "abgelehnt (Code 16"; do sleep 2; waited=$((waited + 2)); [ "$waited" -lt 120 ] || { logs | tail -n 30 >&2; fail "Nach dem Neustart wurde die veränderte Datei nicht abgelehnt."; }; done
docker rm -f "$name" >/dev/null
echo "ok"

echo "Smoke-Test des Vertrauensankers bestanden."
