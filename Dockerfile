# syntax=docker/dockerfile:1
#
# SchrauberOS – ein Container, ein Volume (/data), und NUR EIN winziges unveränderliches Programm im Image.
#
#   • Das Image enthält nichts außer dem Starter (docker/bootstrap.c + Prüfer docker/verify.c + vendortes Monocypher, statisch als static-pie) und der eingebauten
#     App-Version für den ersten Start. Kein Betriebssystem, keine Shell, kein Paketmanager – also auch nichts, was veralten oder gepatcht werden müsste. Der Starter ist
#     der Vertrauensanker: Er startet eine installierte Version nur, wenn sie genau dem entspricht, was der Release-Schlüssel signiert hat.
#   • Jede App-Version ist ein selbständiges Paket und bringt ALLES mit: Anwendung samt Abhängigkeiten, Node, die Systembibliotheken
#     (glibc, libstdc++ …) samt Lader und den Launcher (Versionswahl, Rückfall, Wiederherstellung). Web-Updates erneuern damit
#     die gesamte Laufzeitumgebung; vom Host kommt nur der Kernel.
#   • Der Starter startet den Launcher der aktiven Version mit deren eigener Laufzeit (Lader --library-path …) und fällt auf die
#     eingebaute Version zurück, wenn ein neuer Launcher nicht startet.
#   • Datenbank (SQLite), Dateien, Backups und installierte Versionen liegen unter /data. Migrationen und Basisdaten erledigt die
#     App beim Start selbst, eine Prisma-CLI gibt es nicht.
#   • Stufe "bundle" = das Paket: daraus entsteht auch das signierte Release-Paket für Web-Updates. Es enthält die Dateiliste SOS-TREE (scripts/gen-tree.mjs, schlüsselfrei):
#     Sie ist die Grundlage des Starter-Vertrauensankers (README „Starter-Vertrauensanker“) – das Siegel dazu signiert erst der Release-Job.
#     Das Release-Paket wird aus dem getesteten Image gezogen (docker cp /app), nicht aus einem zweiten Build.

# Basisimage per Digest festgelegt (Lieferkette): ein verschobenes Tag ändert den Build nicht. Dependabot (docker) schlägt neue Digests als Pull
# Request vor. Von Hand erneuern: Digest von `node:24-slim` (Index über alle Architekturen) aus dem Docker-Hub-Register lesen und hier ersetzen.
FROM node:24-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# ───────── Abhängigkeiten und Werkzeuge für den Build ─────────
FROM base AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ───────── Build ─────────
FROM deps AS builder
COPY . .
# Version dieses Builds (CI setzt sie aus dem Tag bzw. als "<x.y.z>-dev.<sha>"); landet in version.json
ARG APP_VERSION
# Git-Commit des Builds (nur zur Anzeige im Systemstatus, steht in version.json)
ARG APP_COMMIT
RUN npx prisma generate \
 && node scripts/write-version.mjs --out . \
 && npm run build \
 && npx esbuild src/launcher/main.ts --bundle --platform=node --format=esm --target=node24 --outfile=launcher.mjs

# Laufzeit zum Mitliefern: Node, alle Bibliotheken, die Node und die nativen Module laden (glibc, libstdc++ …), der Lader und die
# Namensauflösung (nss). Gestartet wird über den mitgelieferten Lader – das Betriebssystem des Hosts/Images wird nicht gebraucht.
RUN set -eux; \
    mkdir -p /runtime/lib; \
    cp /usr/local/bin/node /runtime/node; \
    native="$(find node_modules -name '*.node' -o -name 'libvips*.so*' | tr '\n' ' ')"; \
    for f in $(ldd /usr/local/bin/node $native 2>/dev/null | awk '/=>/ {print $3} /ld-linux/ {print $1}' | sort -u); do cp -L "$f" /runtime/lib/; done; \
    triplet="$(gcc -dumpmachine)"; \
    for n in libnss_files.so.2 libnss_dns.so.2 libresolv.so.2; do cp -L "/lib/$triplet/$n" /runtime/lib/; done; \
    loader="$(ls /runtime/lib | grep -E '^ld-linux' | head -n1)"; \
    echo "lib/$loader" > /runtime/loader

# Das Paket zusammenstellen und seine Dateiliste (SOS-TREE) erzeugen – im selben Stage, kein weiterer 250-MB-Kopierschritt. Der Generator bricht laut ab bei Sonderdateien,
# Setuid/Setgid/Sticky, unzulässigen Namen und Symlinks, die den Baum verlassen: Ein Paket, das der Starter später ablehnen würde, soll gar nicht erst entstehen.
RUN set -eux; \
    mkdir -p /bundle/.next /bundle/prisma; \
    cp -a .next/standalone/. /bundle/; \
    cp -a .next/static /bundle/.next/static; \
    cp -a public /bundle/public; \
    cp -a docs /bundle/docs; \
    cp -a prisma/migrations /bundle/prisma/migrations; \
    cp -a version.json launcher.mjs /bundle/; \
    cp -a /runtime /bundle/runtime; \
    node scripts/gen-tree.mjs /bundle

# ───────── Vertrauensanker des Starters: Schlüssel und Untergrenze aus dem Code (nur aus release-key.ts, keine Umgebungsvariable) ─────────
# Bei Tag-Builds bricht dieser Schritt ab, wenn der Wurzelschlüssel fehlt, gleich dem Release-Schlüssel ist oder ein Testschlüssel wäre: Die Wurzel steht im Image, das vor dem
# Release-Job veröffentlicht wird, und lässt sich danach nicht mehr ändern. Läuft mit dem Node der Basis (TypeScript wird nativ gelesen), ohne npm ci.
FROM base AS trust
ARG APP_VERSION
ARG SOS_TAG_BUILD=0
COPY package.json ./
COPY docker/BASE_VERSION docker/BASE_VERSION
COPY scripts/gen-trust-header.mjs scripts/gen-trust-header.mjs
COPY scripts/lib scripts/lib
COPY src/lib/updates src/lib/updates
COPY src/modules/admin/updates/release-key.ts src/modules/admin/updates/release-key.ts
RUN SOS_TAG_BUILD="${SOS_TAG_BUILD}" node scripts/gen-trust-header.mjs --out /trust-keys.h

# Dasselbe mit den TESTSCHLÜSSELN (src/lib/updates/testdata/anchor/test-keys.ts): nur für das Ziel "runner-test" (Tests der Pipeline und der Entwickler, scripts/smoke-anchor.sh).
# Nie ein veröffentlichtes Image; ein Tag-Build bricht ab.
FROM base AS trust-test
ARG APP_VERSION
ARG SOS_TAG_BUILD=0
COPY package.json ./
COPY docker/BASE_VERSION docker/BASE_VERSION
COPY scripts/gen-trust-header.mjs scripts/gen-trust-header.mjs
COPY scripts/lib scripts/lib
COPY src/lib/updates src/lib/updates
COPY src/modules/admin/updates/release-key.ts src/modules/admin/updates/release-key.ts
COPY docker/test/gen-test-header.mjs docker/test/gen-test-header.mjs
RUN test "${SOS_TAG_BUILD}" = "0" || { echo "Ein Testschlüssel-Image gibt es nie als Tag-Build" >&2; exit 1; } \
 && node docker/test/gen-test-header.mjs --out /trust-keys.h

# ───────── Übersetzer für den Starter (nur gcc und die statische libc, ohne npm ci) ─────────
# Compiler und libc stammen aus einem festen Debian-Schnappschuss (dasselbe Datum, aus dem das Basisimage gebaut wurde – steht als Kommentar in dessen
# /etc/apt/sources.list.d/debian.sources): Gleicher Quelltext + gleiche Schlüssel + gleiche Werkzeuge = gleiches Binary. Einen neueren Compiler gibt es nur mit einem
# bewussten Commit (Datum erhöhen), nicht still über apt. Die statische glibc steckt im Starter – er ist das Einzige im Image, das sich nicht per Web-Update erneuern lässt.
FROM base AS cc
ARG DEBIAN_SNAPSHOT=20261104T212339Z
RUN <<'EOF'
set -eux
cat > /etc/apt/sources.list.d/debian.sources <<SOURCES
Types: deb
URIs: http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}
Suites: bookworm bookworm-updates
Components: main
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg

Types: deb
URIs: http://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}
Suites: bookworm-security
Components: main
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg
SOURCES
# Schnappschuss-Archive tragen ein Ablaufdatum, das lange vorbei ist
apt-get -o Acquire::Check-Valid-Until=false update
apt-get install -y --no-install-recommends gcc libc6-dev
rm -rf /var/lib/apt/lists/*
dpkg-query -W gcc libc6-dev binutils
EOF

# ───────── Der Starter: statisch gelinkt (static-pie), gehärtet, braucht nichts außer dem Kernel ─────────
# Beide Stufen übersetzen mit demselben Skript (docker/build-bootstrap.sh: Prüfsummen der vendorten Bibliothek, Produktionsflags, kein INTERP, Härtung); sie unterscheiden sich
# nur im Header mit den Schlüsseln (bootstrap-test-build: Testschlüssel, nur für Tests, nie veröffentlicht).
FROM cc AS bootstrap-src
COPY docker/bootstrap.c docker/verify.c docker/verify.h docker/build-bootstrap.sh /src/
COPY docker/vendor/monocypher /src/vendor/monocypher

FROM bootstrap-src AS bootstrap-build
COPY --from=trust /trust-keys.h /src/trust-keys.h
RUN sh /src/build-bootstrap.sh

FROM bootstrap-src AS bootstrap-test-build
COPY --from=trust-test /trust-keys.h /src/trust-keys.h
RUN sh /src/build-bootstrap.sh

# ───────── Das Paket: Anwendung + Abhängigkeiten + Laufzeit + Launcher + Dateiliste ─────────
FROM scratch AS bundle
COPY --from=builder /bundle/ ./

# ───────── Verzeichnisse, die es im leeren Image sonst nicht gäbe ─────────
FROM base AS skeleton
RUN mkdir -p /skeleton/data /skeleton/tmp && chmod 1777 /skeleton/tmp

# ───────── Das Image ─────────
# Gemeinsamer Unterbau; der Starter kommt erst im letzten Schritt der beiden Ziele darauf (runner = Produktion mit den Schlüsseln aus dem Code, runner-test = Testschlüssel).
FROM scratch AS runner-base
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=Europe/Berlin \
    DATA_DIR=/data \
    DATABASE_URL=file:/data/schrauberos.db
# Die eingebaute App gehört root und ist für den Betriebsbenutzer nicht schreibbar (kein --chown): Wer die Anwendung kompromittiert, kann den
# eingebauten Code nicht ändern. Geschrieben wird nur nach /data (Datenbank, Dateien, Backups, installierte Versionen) und /tmp.
COPY --from=bundle / /app/
COPY --from=skeleton --chown=1000:1000 /skeleton/ /

USER 1000:1000
WORKDIR /app
EXPOSE 3000
VOLUME ["/data"]
# start-period/retries: Die Prüfung der installierten Version beim Start (ein Web-Update, danach jeder Neustart) und die Migration verlängern den Start; "unhealthy" während eines App-Neustarts ist kosmetisch
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=5 CMD ["/bootstrap", "--healthcheck"]
ENTRYPOINT ["/bootstrap"]

# Testziel: dasselbe Image, der Starter mit den Testschlüsseln (docker build --target runner-test; scripts/smoke-anchor.sh). Nie veröffentlichen.
FROM runner-base AS runner-test
COPY --from=bootstrap-test-build /bootstrap /bootstrap

# Produktion: letzte Stufe = Standardziel
FROM runner-base AS runner
COPY --from=bootstrap-build /bootstrap /bootstrap
