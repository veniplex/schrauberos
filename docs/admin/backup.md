# Backups

Unter **Backups** sichert und stellt die Anwendung ihre Daten wieder her – ohne Zutun am Server.

* **Was gesichert wird:** alles – Kunden, Termine, Rechnungen **samt Belegen**, Handbuch und IT-Dokumentation samt Bildern, Benutzer und
  Einstellungen. Ein Backup entsteht, während die Anwendung läuft; niemand muss warten.
* **Automatisch:** jede Nacht (Standard ab 02:00 Uhr); wann, stellt man unter **Einstellungen → Backups** ein.
  **Schlägt ein automatisches Backup fehl** (meist fehlt Speicherplatz), steht oben auf dieser Seite und auf der Übersicht eine rote Meldung mit Anzahl der Versuche und dem nächsten
  Versuch; die Anwendung probiert es mit wachsender Wartezeit (15 Minuten, 30 Minuten, 1 Stunde … höchstens alle 4 Stunden) immer wieder, bis es gelingt. Bis dahin besteht kein aktueller Schutz –
  bitte Speicherplatz schaffen; mit **„Jetzt erneut versuchen“** in der Meldung probieren Sie es sofort. Die Meldung verschwindet von selbst, sobald ein neueres Backup
  (gleich welcher Art, auch ein von Hand erstelltes) vorhanden ist. Weitere Einzelheiten zeigt der **Systemstatus**.
* **Aufbewahrung:** Unter **Einstellungen → Backups** legen Sie **je Art** fest (Automatisch, Manuell, Vor Update, Vor Wiederherstellung, Vor Datenbank-Änderung, Hochgeladen),
  wie viele der neuesten Backups bleiben und wie alt sie höchstens werden dürfen; `0` bedeutet unbegrenzt (jedes Feld muss ausgefüllt sein – ein leeres Feld gilt nie als „unbegrenzt“). Aufgeräumt wird nach jedem automatischen Backup und nachts.
  **Das neueste Backup bleibt immer erhalten.** Standard: 14 automatische, je 5 „Vor …“-Backups; Manuelle und Hochgeladene bleiben, bis Sie sie löschen.
  **Datenschutz (DSGVO):** Backups enthalten personenbezogene Daten (Kunden, Mitarbeiter, Rechnungen) – auch solche, die Sie im Betrieb längst gelöscht haben. Der Grundsatz der
  Speicherbegrenzung gilt auch für Backups: Legen Sie eine Frist fest, die zu Ihrem Datenschutzkonzept passt (üblich sind einige Wochen bis wenige Monate), und bewahren Sie
  heruntergeladene Kopien nicht länger auf. Die Anwendung kann heruntergeladene Dateien nicht löschen.
* **Jetzt sichern:** „Jetzt Backup erstellen“, z. B. vor größeren Änderungen.
* **Herunterladen:** Jedes Backup lässt sich als Datei herunterladen – bitte gelegentlich eine Kopie **außerhalb des Servers**
  ablegen, denn ein Backup auf demselben Datenträger schützt nicht vor dessen Ausfall. Die Datei enthält alle Daten und ist nicht
  verschlüsselt: sicher aufbewahren.
* **Hochladen:** Eine heruntergeladene Sicherung lässt sich wieder hochladen, z. B. beim Umzug auf einen neuen Server. Die Anwendung prüft die Datei streng: Es werden nur
  Ordner und normale Dateien übernommen (keine Verknüpfungen, keine Sonderdateien), und sie muss in den **freien Speicherplatz** passen – auch entpackt: Eine Datei, die sich
  zu einer riesigen Datenbank entpackt, wird abgewiesen. So füllt die Seite den Server nie voll.
* **Wiederherstellen:** Wählen Sie ein Backup und „Wiederherstellen“. Zur Sicherheit fragt ein Fenster nach und verlangt, dass Sie das Wort „wiederherstellen“ eintippen. Die Anwendung legt vorher automatisch ein Backup des aktuellen
  Stands an („Vor Wiederherstellung“) und startet kurz neu. **Alle Änderungen seit dem gewählten Backup gehen dabei verloren.** Auch der Notzugang gehört zu den Daten: Nach der Wiederherstellung eines älteren Backups kann ein gedruckter Wiederherstellungs-Code veraltet sein (er gilt nur, solange er zum Stand der Datenbank passt). Erzeugen Sie dann unter **Mein Konto → Notzugang** einen neuen. **API-Tokens** für die Programmierschnittstelle werden bei der Wiederherstellung **alle widerrufen** (das Backup kennt Widerrufe nicht, die danach geschehen sind): Legen Sie die Tokens der angebundenen Systeme neu an. Auch die **Zwei-Faktor-Anmeldung** gehört zu den Daten: Ihre Geheimnisse sind mit dem Schlüssel dieser Installation verschlüsselt, der **nicht** im Backup steht. Wird ein Backup auf einer anderen Installation oder einem neuen Volume ohne diesen Schlüssel wiederhergestellt, ist die Zwei-Faktor-Anmeldung **für alle Konten zurückgesetzt**: Die Konten melden sich nur mit dem Passwort an, sehen beim ersten Anmelden einen Hinweis und richten sie neu ein; das Audit-Log hält es fest (verlangt die Einstellung die Pflicht für Administratoren, müssen diese sofort neu einrichten).
  Gegebenenfalls müssen Sie sich danach neu anmelden.
* **Sicherheitsnetz:** Startet die Anwendung mit den wiederhergestellten Daten nicht, wird automatisch der vorherige Stand
  zurückgesetzt; das Ergebnis steht auf der Backup-Seite.
* **Weitere automatische Backups:** vor jedem Update („Vor Update“) und vor Änderungen an der Datenbank-Struktur
  („Vor Datenbank-Änderung“).
* Ein Backup einer **neueren** Programmversion lässt sich nicht in eine ältere einspielen; die Seite weist darauf hin.

Belege und Bilder liegen als normale Dateien auf dem Server, auch ohne die Anwendung auffindbar (Rechnungen nach Jahr, Eingang/Ausgang,
Datum, Partner und Nummer). Sie sollten nicht von Hand verändert oder gelöscht werden.
