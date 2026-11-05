# syntax=docker/dockerfile:1
#
# SchrauberOS – Produktions-Image (Next.js standalone + PostgreSQL).
# Targets:
#   runner   (Standard)  schlankes Laufzeit-Image der Anwendung
#   migrator              führt Datenbank-Migrationen und den Basis-Seed aus (siehe docker-compose.yml)

FROM node:24-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# ───────── Abhängigkeiten ─────────
FROM base AS deps
# Build-Werkzeuge nur als Rückfall, falls für better-sqlite3 kein Prebuild verfügbar ist
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ───────── Build ─────────
FROM deps AS builder
COPY . .
# Im Container läuft immer PostgreSQL: Schema ableiten und den Client dagegen generieren.
# (generate verbindet sich nicht mit der Datenbank; die URL dient nur der Provider-Auswahl.)
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN npm run db:sync-pg && npx prisma generate && npm run build

# ───────── Migrationen / Seed ─────────
FROM builder AS migrator
# DATABASE_URL kommt zur Laufzeit aus docker-compose.yml
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed"]

# ───────── Laufzeit ─────────
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=Europe/Berlin
RUN apt-get update && apt-get install -y --no-install-recommends tzdata && rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
