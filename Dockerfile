# syntax=docker/dockerfile:1
#
# SchrauberOS – ein Container, ein Volume (/data), und NUR EIN winziges unveränderliches Programm im Image.
#
#   • Das Image enthält nichts außer dem Starter (docker/bootstrap.c, statisch, ~100 Zeilen) und der eingebauten App-Version für
#     den ersten Start. Kein Betriebssystem, keine Shell, kein Paketmanager – also auch nichts, was veralten oder gepatcht
#     werden müsste.
#   • Jede App-Version ist ein selbständiges Paket und bringt ALLES mit: Anwendung samt Abhängigkeiten, Node, die Systembibliotheken
#     (glibc, libstdc++ …) samt Lader und den Launcher (Versionswahl, Rückfall, Wiederherstellung). Web-Updates erneuern damit
#     die gesamte Laufzeitumgebung; vom Host kommt nur der Kernel.
#   • Der Starter startet den Launcher der aktiven Version mit deren eigener Laufzeit (Lader --library-path …) und fällt auf die
#     eingebaute Version zurück, wenn ein neuer Launcher nicht startet.
#   • Datenbank (SQLite), Dateien, Backups und installierte Versionen liegen unter /data. Migrationen und Basisdaten erledigt die
#     App beim Start selbst, eine Prisma-CLI gibt es nicht.
#   • Stufe "bundle" = das Paket: daraus entsteht auch das signierte Release-Paket für Web-Updates.

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

# ───────── Der Starter: statisch gelinkt, braucht nichts außer dem Kernel ─────────
FROM deps AS bootstrap
COPY docker/bootstrap.c /src/bootstrap.c
RUN gcc -static -Os -s -Wall -o /bootstrap /src/bootstrap.c

# ───────── Das Paket: Anwendung + Abhängigkeiten + Laufzeit + Launcher ─────────
FROM scratch AS bundle
COPY --from=builder /app/.next/standalone/ ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/docs ./docs
COPY --from=builder /app/prisma/migrations ./prisma/migrations
COPY --from=builder /app/version.json ./version.json
COPY --from=builder /app/launcher.mjs ./launcher.mjs
COPY --from=builder /runtime ./runtime

# ───────── Verzeichnisse, die es im leeren Image sonst nicht gäbe ─────────
FROM base AS skeleton
RUN mkdir -p /skeleton/data /skeleton/tmp && chmod 1777 /skeleton/tmp

# ───────── Das Image ─────────
FROM scratch AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=Europe/Berlin \
    DATA_DIR=/data \
    DATABASE_URL=file:/data/schrauberos.db
COPY --from=bootstrap /bootstrap /bootstrap
# Die eingebaute App gehört root und ist für den Betriebsbenutzer nicht schreibbar (kein --chown): Wer die Anwendung kompromittiert, kann den
# eingebauten Code nicht ändern. Geschrieben wird nur nach /data (Datenbank, Dateien, Backups, installierte Versionen) und /tmp.
COPY --from=bundle / /app/
COPY --from=skeleton --chown=1000:1000 /skeleton/ /

USER 1000:1000
WORKDIR /app
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD ["/bootstrap", "--healthcheck"]
ENTRYPOINT ["/bootstrap"]
