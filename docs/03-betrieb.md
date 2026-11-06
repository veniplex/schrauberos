# Betrieb

Ziel: einmal aufsetzen, danach läuft alles über die Weboberfläche – Backups, Wiederherstellung, Updates, Einstellungen.
Am Container muss nichts mehr angefasst werden.

## Installation (einmalig)

Ein Container, ein Volume, keine Datenbank-Einrichtung. Auf dem Server genügt die `docker-compose.yml`:

```bash
# einmalig (Repo privat): am Server bei ghcr.io anmelden – Token mit Recht "read:packages"
echo <TOKEN> | docker login ghcr.io -u <github-benutzer> --password-stdin

docker compose up -d
```

In **Portainer** genügt es, den Inhalt von `docker-compose.yml` als Stack einzufügen.

Danach im Browser `http://<server>:3000` öffnen: Die **Ersteinrichtung** fragt Werkstattname, Zeitzone und das Konto des
ersten Administrators ab (optional mit Beispieldaten zum Ausprobieren). **Bitte die Einrichtung durchführen, bevor die
Anwendung von außen erreichbar ist** – wer sie zuerst aufruft, wird Administrator.

Alles, was die Anwendung speichert, liegt im Volume `app-data` (`/data`): die SQLite-Datenbank, Backups und per Web-Update
installierte Versionen. Das Volume muss auf einer **lokalen Platte** liegen – SMB-/NFS-Freigaben vertragen sich nicht mit
SQLite (Sperren funktionieren dort nicht zuverlässig).

## Wo erledige ich was?

| Aufgabe | Wo |
| --- | --- |
| Backup anlegen, herunterladen, hochladen, wiederherstellen | Verwaltung → **Backups** |
| Zeitplan der automatischen Backups | Verwaltung → Einstellungen → Backups |
| Neue Version installieren | Verwaltung → **Updates** |
| Zugang zu den Updates (Token) | Verwaltung → Einstellungen → Updates |
| Zeitzone, Name, Logo, Öffnungszeiten | Verwaltung → Einstellungen → Werkstatt |
| Benutzer, Rollen | Verwaltung → Benutzer / Rollen & Rechte |
| Funktionen ein-/ausschalten | Verwaltung → Module & Funktionen |
| Was ist wann passiert? | Verwaltung → Audit-Log |

## Backups

Ein Backup sichert die **gesamte Anwendung**: einen konsistenten Schnappschuss der Datenbank (Kunden, Termine, Dokumentation,
Benutzer, Einstellungen …) **und alle Dateien** (Rechnungsbelege, Dokumentationsbilder). Es entsteht im laufenden Betrieb, ohne
die Anwendung anzuhalten, und liegt unter `/data/backups/<name>/` (`database.db.gz`, `files/`, `info.json`).

* **Kaum Plattenplatz:** Dateien werden nie verändert, deshalb enthält ein Backup nur **Verweise (Hardlinks)** auf sie. Täglich 14
  Backups kosten fast nichts extra; Platz belegen nur Dateien, die es später nicht mehr im Live-Bestand gibt.
* **Automatisch:** jede Nacht (Standard ab 02:00 Uhr), die neuesten 14 automatischen Backups bleiben erhalten. Zeitplan und
  Anzahl stehen unter Einstellungen → Backups. Wurde die Uhrzeit verpasst (Server aus), holt die Anwendung das nach dem Start nach.
* **Manuell:** „Jetzt Backup erstellen“. Manuelle und hochgeladene Backups werden nie automatisch gelöscht.
* **Herunterladen / Hochladen:** Ein Backup lässt sich als Archiv (`.tar`) herunterladen – gestreamt, ohne Zwischendatei, auch bei
  vielen Gigabyte – und wieder hochladen, z. B. für Kopien außerhalb des Servers oder beim **Umzug auf einen neuen Server**
  (neu aufsetzen → hochladen → wiederherstellen). Hochgeladen werden außerdem reine SQLite-Dateien (dann ohne Dateien).
* **Wiederherstellen:** prüft das Backup, legt vorher automatisch ein Backup des aktuellen Stands an („Vor Wiederherstellung“)
  und startet die Anwendung neu. Der Launcher tauscht Datenbank **und Dateien** aus (enthält ein Backup keine Dateien, bleiben
  die vorhandenen unberührt). **Startet die Anwendung mit den wiederhergestellten Daten nicht gesund, setzt der Launcher
  automatisch alles zurück** – samt der Änderungen, die zuletzt noch nicht in die Hauptdatei geschrieben waren. Das Ergebnis
  steht auf der Backup-Seite. Danach ist gegebenenfalls eine neue Anmeldung nötig.
* **Weitere automatische Sicherungen:** vor jedem Web-Update („Vor Update“) und vor Datenbank-Änderungen durch eine neue
  Version („Vor Datenbank-Änderung“).
* Backups einer **neueren** Anwendungsversion lassen sich nicht in eine ältere einspielen (die Seite sagt es). Ältere Backups
  werden beim Start automatisch auf das aktuelle Schema gebracht. Hochgeladene Archive werden strikt geprüft (nur Ordner und
  normale Dateien, gültige Datenbank).

Belege und Bilder liegen als **normale Dateien** im Volume und sind auch ohne die Anwendung auffindbar:

```text
/data/files/rechnungen/2026/eingang/2026-03-14_Lieferant-GmbH_RE-1234.pdf
/data/files/rechnungen/2026/ausgang/…
/data/files/doku/werkstatt/…
```

Der Dateiname eines Belegs folgt Rechnungsdatum, Geschäftspartner und Nummer und wird angepasst, wenn man diese später ändert.
Dateien nicht von Hand verändern oder löschen – die Datenbank verweist darauf (Lesen und Kopieren ist unbedenklich).

Gut zu wissen:

* Backups sind **nicht verschlüsselt** und enthalten alle Daten – sicher aufbewahren. Ein Backup auf demselben Datenträger
  schützt nicht vor dessen Ausfall: gelegentlich eine Kopie außerhalb des Servers ablegen (Herunterladen).
* Geheimnisse (z. B. das Update-Token) liegen verschlüsselt in der Datenbank; der Schlüssel (`/data/secret.key`) ist **nicht**
  Teil der Backups. Nach einer Wiederherstellung auf einem anderen System muss das Token neu eingegeben werden.

**Notfall ohne Weboberfläche:** Startet die Anwendung gar nicht, liegen die Backups trotzdem im Volume. Von Hand: Container
stoppen, aus `/data/backups/<name>/database.db.gz` die Datenbank entpacken (`gunzip`) und als `/data/schrauberos.db` ablegen
(alte `schrauberos.db-wal`/`-shm` löschen), den Ordner `files/` des Backups nach `/data/files` kopieren, Container starten.

## Updates

Unter **Verwaltung → Updates** (Recht `updates.manage`) lässt sich die Anwendung ohne neues Docker-Image aktualisieren:
Die Seite prüft GitHub auf ein neueres Release, zeigt die Änderungen, und **Auf Version x aktualisieren** installiert es.

Voraussetzung für das private Repository: unter Einstellungen → Updates ein **GitHub-Token** hinterlegen (Fine-grained Token
nur für dieses Repository mit `Contents: Read-only`). Es wird verschlüsselt gespeichert. Ist das Repository öffentlich,
entfällt das Token.

So läuft ein Update ab:

1. Es wird automatisch ein **Backup** angelegt (scheitert das, wird nicht aktualisiert).
2. Das Paket wird heruntergeladen. Geprüft werden die **Ed25519-Signatur** des Manifests (gegen den in der App eingebauten
   Schlüssel) und die **SHA-256-Prüfsumme** des Pakets. Ungültiges wird nie entpackt.
3. Das Paket (**Anwendung, Abhängigkeiten, Node, Systembibliotheken und Launcher**) wird nach
   `/data/app/versions/<version>` entpackt und der Zeiger `/data/app/active` darauf gesetzt; die App meldet dem Launcher einen
   Neustart, der Starter im Image wählt neu und startet den Launcher der neuen Version – mit deren eigener Laufzeit.
4. Die neue Version migriert beim Start die Datenbank selbst. Antwortet sie nicht innerhalb von 90 Sekunden gesund
   (`/api/health`) oder scheitern die Migrationen, **fällt der Launcher automatisch auf die vorherige Version zurück**. Stürzt
   sogar der neue Launcher ab, nimmt der Starter die im Image eingebaute Version. Das Ergebnis steht danach auf der
   Update-Seite; das Backup „Vor Update“ liegt bereit.
5. Die Seite lädt sich nach dem Neustart selbst neu.

Wichtig:

* **Alles außer dem Starter wird per Web-Update erneuert** – auch Node und die Systembibliotheken. Die Update-Seite zeigt die
  laufende Node-Version. Das Image muss praktisch nie neu gezogen werden: nur wenn ein Release den Vertrag des Starters ändert
  (dann sagt die Seite es) oder man die Architektur wechselt. Neu ziehen: `docker compose pull && docker compose up -d` (die
  Daten im Volume bleiben).
* Ein neu gezogenes Image löst ein älteres Web-Update ab: Es gilt immer die neuere der beiden Versionen.
* Aufräumen: Es bleiben nur die aktive und die vorherige Version im Volume (je rund 200 MB).
* Die Update-Funktion ist ausschaltbar (Verwaltung → Module & Funktionen).

## Weiteres

* **HTTPS:** Läuft die App hinter einem Reverse Proxy oder Tunnel mit HTTPS, erkennt sie das am Header `x-forwarded-proto` und
  setzt das Cookie-Flag „Secure“ selbst. Sendet der Proxy den Header nicht, funktioniert alles, nur ohne dieses Flag.
  Erzwingen lässt es sich über die Umgebungsvariable `SESSION_COOKIE_SECURE=true|false`.
* **Reverse Proxy:** Erscheint beim Speichern „Invalid Server Actions request“, leitet der Proxy den öffentlichen Host nicht per
  `x-forwarded-host` weiter. Dann die Domain in `next.config.ts` unter `experimental.serverActions.allowedOrigins` eintragen.
* **Version festlegen:** `SCHRAUBEROS_VERSION=1.0.0` in einer `.env` neben der `docker-compose.yml` bestimmt das Image beim
  Neu-Erstellen des Containers (Standard `latest`).
* **Zeitzone:** Einstellungen → Werkstatt; sie gilt sofort und wird bei jedem Start angewendet.
* **Gleichzeitiges Arbeiten:** Mehrere Personen können gleichzeitig arbeiten. Speichern zwei Personen denselben Datensatz,
  gewinnt die erste; die zweite bekommt einen Hinweis („zwischenzeitlich geändert“) und überschreibt nichts.
* **Logs:** Der Launcher und die Anwendung schreiben nach stdout (`docker compose logs app`, in Portainer „Logs“).

## Module im Betrieb ein- und ausschalten

Unter **Verwaltung → Module & Funktionen** lassen sich Module und einzelne Funktionen jederzeit ein- und ausschalten.
Das ändert keine Daten; ausgeschaltete Funktionen sind nur nicht mehr erreichbar. Für Rechte und Rollen: Die Rechte
ausgeschalteter Funktionen werden in der Rollenverwaltung markiert und wirken erst nach dem Wiedereinschalten.
