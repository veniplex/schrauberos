# Betrieb

## Produktion mit Docker (PostgreSQL)

Auf GitHub baut eine Action bei jedem Push auf `main` das Image und legt es in der GitHub Container Registry ab
(`ghcr.io/veniplex/schrauberos`). Auf dem Server braucht es nur `docker-compose.yml` und `.env`.

```bash
# einmalig (Repo privat): am Server bei ghcr.io anmelden – Token mit Recht "read:packages"
echo <TOKEN> | docker login ghcr.io -u <github-benutzer> --password-stdin

cp docker.env.example .env      # Passwörter & Co. anpassen
docker compose pull
docker compose up -d
```

Gestartet werden zwei Dienste: `db` (PostgreSQL, Daten im Volume `db-data`, nicht nach außen veröffentlicht) und `app`
(Port `APP_PORT`, Standard 3000). Die App wendet beim Start selbst die Datenbank-Migrationen an und legt Rollen sowie
den Erst-Admin an (idempotent, siehe `docker-entrypoint.sh`). In **Portainer** genügt es, den Inhalt von
`docker-compose.yml` als Stack einzufügen und die Variablen aus `docker.env.example` zu setzen.

## Wichtig im Betrieb

* **`POSTGRES_PASSWORD` ändern** – ohne Wert startet Compose gar nicht.
* **HTTPS:** Ist die App über HTTPS erreichbar (Reverse Proxy oder Tunnel), `SESSION_COOKIE_SECURE=true` setzen. Bei
  reinem HTTP im LAN muss es `false` bleiben, sonst ist kein Login möglich.
* **Backups:** `docker compose exec db pg_dump -U schrauberos schrauberos > backup.sql`. Das enthält auch
  **Rechnungs-Belege und Doku-Bilder**, denn die liegen in der Datenbank. Sie wächst also mit dem Archiv.
* **Update:** `docker compose pull && docker compose up -d`.
* **Version festlegen:** `SCHRAUBEROS_VERSION=1.0.0` in der `.env` (Tags `vX.Y.Z` erzeugen versionierte Images),
  sonst `latest`.
* **Zeitzone:** Termine werden in der Zeitzone `TZ` (Standard `Europe/Berlin`) ein- und ausgegeben.
* **Reverse Proxy:** Erscheint beim Speichern „Invalid Server Actions request“, leitet der Proxy den öffentlichen Host
  nicht per `x-forwarded-host` weiter. Dann die Domain in `next.config.ts` unter
  `experimental.serverActions.allowedOrigins` eintragen.
* **Pangolin / Newt:** `docker-compose.pangolin.yml` betreibt die App ohne offene Ports hinter einem Tunnel.

## Datenbank-Stand in der Entwicklungsphase

Solange die Anwendung nur Demodaten enthält, gibt es keine Migrationshistorie, sondern eine Baseline (siehe Kapitel
*Entwicklung*). Ändert sich das Schema, muss ein bestehender Stack neu angelegt werden:

```bash
docker compose down -v      # löscht das Datenbank-Volume!
docker compose up -d
```

Sobald echte Daten im Spiel sind, wird auf inkrementelle Migrationen umgestellt; ab dann genügt `pull` + `up -d`.

## Module im Betrieb ein- und ausschalten

Unter **Verwaltung → Module & Funktionen** lassen sich Module und einzelne Funktionen jederzeit ein- und ausschalten.
Das ändert keine Daten; ausgeschaltete Funktionen sind nur nicht mehr erreichbar. Für Rechte und Rollen: Die Rechte
ausgeschalteter Funktionen werden in der Rollenverwaltung markiert und wirken erst nach dem Wiedereinschalten.
