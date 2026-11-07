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
