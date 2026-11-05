#!/bin/sh
# Startskript des Produktions-Containers: Datenbank vorbereiten, dann die App starten.
set -e

echo "[schrauberos] Datenbank-Migrationen anwenden …"
prisma migrate deploy

echo "[schrauberos] Basisdaten anlegen (idempotent) …"
prisma db seed

echo "[schrauberos] Starte Anwendung …"
exec node server.js
