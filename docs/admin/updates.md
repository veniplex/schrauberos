# Updates

Unter **Updates** aktualisieren Administratoren die Anwendung – **ohne Zugriff auf den Server**.

1. Die Seite zeigt die installierte Version und prüft, ob eine neuere veröffentlicht ist; „Jetzt prüfen“ fragt sofort nach.
2. Gibt es eine neue Version, stehen die Änderungen dabei (aus den Notizen des Releases). Darunter zeigt **„Was ist neu“** die Änderungen der **installierten** Version. Die Notizen stammen von GitHub und
   werden beim ersten Abruf als Kopie im Datenverzeichnis gespeichert – danach stehen sie auch ohne Netzverbindung da. **„Auf Version x aktualisieren“** startet das Update.
3. Die Anwendung legt zuerst ein **Backup** an, lädt das Paket herunter und prüft **Signatur und Prüfsumme** – nichts Ungeprüftes
   wird installiert. Dann startet sie kurz neu; die Seite lädt sich danach selbst neu.

Ein Update erneuert die **gesamte Anwendung samt Laufzeitumgebung** (nicht nur den Programmcode). Startet die neue Version nicht
einwandfrei, kehrt die Anwendung **automatisch zur bisherigen zurück**; das Ergebnis des letzten Updates steht auf der Seite.

Für ein privates Repository braucht die Update-Prüfung ein **Zugriffs-Token** mit Leserecht auf die Versionen
(**Einstellungen → Updates**). Es wird verschlüsselt gespeichert und gehört nicht zu den Backups. Die Anwendung schickt es **nur an GitHub selbst**
(an die API), nie an die Server, auf die GitHub den Download weiterleitet; Weiterleitungen auf andere Adressen lehnt sie ab.

Verlangt eine Version ausnahmsweise einen neuen Unterbau, sagt die Seite es und bietet kein Update per Klick an; dann
muss der Server-Betreuer das Image einmal neu ziehen.

## Integritätsprüfung

Jede Version, die per Update installiert wird, trägt ein **Siegel** (vom Entwickler signiert) und eine **Dateiliste**. Die Anwendung prüft beides schon **vor der Installation**, und der Start prüft die installierte
Version bei **jedem Neustart** noch einmal vollständig: Jede Datei muss genau der Liste entsprechen, und es darf nichts Zusätzliches im Ordner der Version liegen. Unter **Installierte Version** steht,
wann und wie lange die letzte Prüfung dauerte (die im Image eingebaute Version wird nicht geprüft; sie ist die Vertrauensbasis).

Besteht eine installierte Version die Prüfung beim Start **nicht**, startet die Anwendung sie nicht, sondern fällt zurück: zuerst auf die vorherige installierte Version (die dann ebenfalls geprüft wird), danach auf die
eingebaute. Die Seite zeigt den Grund in Klartext (zum Beispiel „Eine Datei der Version wurde verändert“ oder „Es gibt eine zusätzliche Datei“), und die Administration findet einen Eintrag im **Audit-Log**
(„Integritätsprüfung einer installierten Version fehlgeschlagen“). Das kann auf eine Manipulation oder auf ein beschädigtes Volume hinweisen; auf einem **NAS** sind zusätzliche Dateien oft Vorschau- oder Indexdienste
des NAS in dem Ordner. Die Version wird dann gesperrt: Der Knopf **„Version … reparieren“** lädt dasselbe Paket erneut, prüft es vollständig und ersetzt die beschädigte Kopie.

* **„Prüfung nicht abgeschlossen“** heißt: Die Prüfung wurde unterbrochen oder konnte nicht lesen (Zeitüberschreitung auf einer langsamen Platte, Container-Stopp während der Prüfung). Das ist **kein** Befund über die
  Dateien; die Version wird nicht gesperrt, bis dahin läuft die eingebaute Version, und der nächste Start prüft erneut. Wiederholt sich das dreimal in Folge, gilt die Version als fehlgeschlagen.
* **Ist die eingebaute Version zu alt für die Datenbank** (nach einem Rückfall von einer bewährten Version, deren Updates die Datenbank erweitert haben), startet die Anwendung **nicht**, um die Daten nicht zu gefährden.
  Sie schreibt eine deutliche Meldung ins Container-Log; abhelfen kann man nur, indem man das Docker-Image aktualisiert (der Server-Betreuer: `docker compose pull && docker compose up -d`).
* **Hinweis auf ablaufende Beglaubigung:** Wird ein Release mit einem neu beglaubigten Schlüssel signiert, steht 90 Tage vor dem Ablauf der Beglaubigung ein Hinweis an der Version. Danach lässt sich diese Version nicht mehr
  installieren, bis ein erneuertes Release erscheint. Bereits installierte Versionen laufen weiter.

Was die Prüfung **nicht** leistet: Sie schützt davor, dass veränderter oder nachgeladener Code **einen Neustart überlebt**. Eine bereits laufende, kompromittierte Anwendung kann damit nicht gestoppt werden,
und auch Daten (Datenbank, Dateien, Backups) prüft sie nicht.
