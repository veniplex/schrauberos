# Verwaltung

Der Bereich **Verwaltung** gehört zur Plattform und steht Administratoren (und Personen mit den entsprechenden Rechten) zur
Verfügung. Er ist immer aktiv und lässt sich nicht ausschalten.

## Benutzer

Unter **Benutzer** werden Konten angelegt, geändert und deaktiviert.

* **Anlegen:** Benutzername (Kleinbuchstaben, Ziffern, Punkt, Binde- und Unterstrich; später nicht änderbar), Anzeigename, Rollen
  und ein Startpasswort. Mit „Passwort beim nächsten Login ändern“ muss die Person ein eigenes wählen.
* **Passwort zurücksetzen:** Neues Passwort eintragen – bestehende Anmeldungen der Person werden beendet.
* **Schutzregeln:** Der letzte aktive Administrator kann weder gelöscht noch deaktiviert werden, das eigene Konto lässt sich nicht
  deaktivieren, und Administrator-Rollen vergeben nur Administratoren.

## Rollen und Rechte

Eine **Rolle** bündelt Rechte; ein Benutzer kann mehrere Rollen haben, die Rechte addieren sich. Unter **Rollen & Rechte** sind die
Rechte nach Bereich und Funktion gegliedert (ansehen, anlegen, bearbeiten, löschen …). Mitgeliefert sind Administrator,
Geschäftsführung, Büro / Verwaltung, Serviceberater, Mechaniker, Lager und IT-Administrator – sie lassen sich anpassen.

* **Administrator-Rollen** haben immer alle Rechte, auch für künftige Funktionen.
* Rechte ausgeschalteter Funktionen sind markiert und wirken erst nach dem Wiedereinschalten.
* Die Rechte „Benutzer verwalten“ und „Rollen verwalten“ sind faktisch Administratorrechte – bitte sparsam vergeben.

## Einstellungen

Die **Einstellungen** sind in Reiter gegliedert:

* **Werkstatt:** Name, Untertitel, Adresse, Logo, Akzentfarbe, **Zeitzone** (gilt sofort) und Öffnungszeiten.
* **Termine:** Kalender-Raster, Arbeitsplätze und Terminarten.
* **Reifenlager:** Grenzwerte für die Ampel (Profiltiefe und Alter).
* **Backups:** Zeitplan der automatischen Backups.
* **Updates:** Zugang für die Update-Prüfung.

## Module & Funktionen

Die fachlichen Bereiche (Werkstatt, Büro, IT & Netzwerk) bestehen aus **Funktionen** (Termine, Reifenlager, Rechnungsarchiv …).
Unter **Module & Funktionen** schalten Administratoren ganze Module oder einzelne Funktionen ein und aus – etwa, wenn ein Betrieb
den Fuhrpark nicht nutzt.

* Beim Ausschalten **bleiben alle Daten erhalten**; nur der Zugriff wird gesperrt (Seiten, Navigation, Übersicht, Rechte).
* Manche Funktionen brauchen andere (Reifenlager und Termine brauchen die Fahrzeuge). Die Seite zeigt die Abhängigkeiten und
  macht abhängige Funktionen automatisch unbenutzbar.
* Verwaltung und Hilfe gehören zur Plattform und sind nicht schaltbar.

## Backups

Unter **Backups** sichert und stellt die Anwendung ihre Daten wieder her – ohne Zutun am Server.

* **Was gesichert wird:** alles – Kunden, Termine, Rechnungen **samt Belegen**, Dokumentation samt Bildern, Benutzer und
  Einstellungen. Ein Backup entsteht, während die Anwendung läuft; niemand muss warten.
* **Automatisch:** jede Nacht (Standard ab 02:00 Uhr). Wie viele automatische Backups erhalten bleiben (Standard 14) und wann sie
  entstehen, stellt man unter **Einstellungen → Backups** ein. Manuelle Backups werden nie automatisch gelöscht.
* **Jetzt sichern:** „Jetzt Backup erstellen“, z. B. vor größeren Änderungen.
* **Herunterladen:** Jedes Backup lässt sich als Datei herunterladen – bitte gelegentlich eine Kopie **außerhalb des Servers**
  ablegen, denn ein Backup auf demselben Datenträger schützt nicht vor dessen Ausfall. Die Datei enthält alle Daten und ist nicht
  verschlüsselt: sicher aufbewahren.
* **Hochladen:** Eine heruntergeladene Sicherung lässt sich wieder hochladen, z. B. beim Umzug auf einen neuen Server.
* **Wiederherstellen:** Wählen Sie ein Backup und „Wiederherstellen“. Die Anwendung legt vorher automatisch ein Backup des aktuellen
  Stands an („Vor Wiederherstellung“) und startet kurz neu. **Alle Änderungen seit dem gewählten Backup gehen dabei verloren.**
  Gegebenenfalls müssen Sie sich danach neu anmelden.
* **Sicherheitsnetz:** Startet die Anwendung mit den wiederhergestellten Daten nicht, wird automatisch der vorherige Stand
  zurückgesetzt; das Ergebnis steht auf der Backup-Seite.
* **Weitere automatische Backups:** vor jedem Update („Vor Update“) und vor Änderungen an der Datenbank-Struktur
  („Vor Datenbank-Änderung“).
* Ein Backup einer **neueren** Programmversion lässt sich nicht in eine ältere einspielen; die Seite weist darauf hin.

Belege und Bilder liegen als normale Dateien auf dem Server, auch ohne die Anwendung auffindbar (Rechnungen nach Jahr, Eingang/Ausgang,
Datum, Partner und Nummer). Sie sollten nicht von Hand verändert oder gelöscht werden.

## Updates

Unter **Updates** aktualisieren Administratoren die Anwendung – **ohne Zugriff auf den Server**.

1. Die Seite zeigt die installierte Version und prüft, ob eine neuere veröffentlicht ist; „Jetzt prüfen“ fragt sofort nach.
2. Gibt es eine neue Version, stehen die Änderungen dabei. **„Auf Version x aktualisieren“** startet das Update.
3. Die Anwendung legt zuerst ein **Backup** an, lädt das Paket herunter und prüft **Signatur und Prüfsumme** – nichts Ungeprüftes
   wird installiert. Dann startet sie kurz neu; die Seite lädt sich danach selbst neu.

Ein Update erneuert die **gesamte Anwendung samt Laufzeitumgebung** (nicht nur den Programmcode). Startet die neue Version nicht
einwandfrei, kehrt die Anwendung **automatisch zur bisherigen zurück**; das Ergebnis des letzten Updates steht auf der Seite.

Für ein privates Repository braucht die Update-Prüfung ein **Zugriffs-Token** mit Leserecht auf die Versionen
(**Einstellungen → Updates**). Es wird verschlüsselt gespeichert und gehört nicht zu den Backups.

Verlangt eine Version ausnahmsweise einen neuen Unterbau, sagt die Seite es und bietet kein Update per Klick an; dann
muss der Server-Betreuer das Image einmal neu ziehen.

## Audit-Log

Das **Audit-Log** zeigt, wer wann was getan hat: Anmeldungen (auch fehlgeschlagene), Passwort- und Profiländerungen, Änderungen an
Benutzern, Rollen, Modulen und Einstellungen, Backups, Updates sowie Löschungen von Kunden, Fahrzeugen, Reifensätzen, Terminen,
Rechnungen, Mitarbeitern, Fuhrpark-Einträgen, Netzwerk-Geräten und Dokumentationsseiten.

Die Liste lässt sich nach Benutzer oder Objekt durchsuchen und nach Aktionsgruppe filtern. Der Name der handelnden Person bleibt
auch erhalten, wenn das Konto später gelöscht wird.
