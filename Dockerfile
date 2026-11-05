# syntax=docker/dockerfile:1
#
# SchrauberOS – Produktions-Image (Next.js standalone + PostgreSQL).
# Ein einziges Image: beim Start werden zuerst die Datenbank-Migrationen angewendet
# (docker-entrypoint.sh), danach startet die App.

FROM node:24-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# ───────── Abhängigkeiten (inkl. Dev, für den Build) ─────────
FROM base AS deps
# Build-Werkzeuge nur als Rückfall, falls für better-sqlite3 kein Prebuild verfügbar ist
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ───────── Nur Produktions-Abhängigkeiten (enthält prisma + tsx für Migration/Seed) ─────────
FROM deps AS prod-deps
RUN npm prune --omit=dev

# ───────── Build ─────────
FROM deps AS builder
COPY . .
# Im Container läuft immer PostgreSQL: Schema ableiten und den Client dagegen generieren.
# (generate verbindet sich nicht mit der Datenbank; die URL dient nur der Provider-Auswahl.)
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN npm run db:sync-pg && npx prisma generate && npm run build

# ───────── Laufzeit ─────────
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=Europe/Berlin \
    PATH=/app/node_modules/.bin:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends tzdata && rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
# Migration + Seed beim Start: Prisma-CLI/tsx (prod-deps) sowie Schema, Migrationen, Seed und dessen Quellen
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/prisma.config.ts /app/tsconfig.json ./
COPY --from=builder --chown=node:node /app/src ./src
COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["./docker-entrypoint.sh"]
