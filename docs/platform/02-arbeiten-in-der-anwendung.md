# Arbeiten in der Anwendung

## Gleichzeitig arbeiten

Mehrere Personen können gleichzeitig mit der Anwendung arbeiten. Öffnen zwei Personen denselben Datensatz zum Bearbeiten und
speichern nacheinander, gewinnt die erste. Die zweite sieht den Hinweis *„Dieser Datensatz wurde inzwischen von jemand anderem
geändert“* – es wird nichts überschrieben. Dann Seite neu laden und die Änderung erneut vornehmen.

Bei Terminen kann ein Arbeitsplatz nie doppelt belegt werden, auch wenn zwei Personen gleichzeitig buchen.

## Formulare

* **Pflichtfelder** tragen einen Stern (*). Beim Speichern prüft die Anwendung alle Eingaben und nennt Fehler **am Feld** und gesammelt oben im Formular
  („Bitte diese 2 Angaben prüfen“) – ein Klick auf einen Eintrag springt ins Feld. Die Meldungen sagen, was fehlt: eine ungültige E-Mail-Adresse, eine FIN mit
  falscher Länge, ein ungültiges Datum, eine Zahl außerhalb des erlaubten Bereichs.
* **Ihre Eingabe bleibt erhalten**, auch wenn das Speichern scheitert – bei einem Fehler im Formular ebenso wie bei **„Keine Verbindung zum Server“**
  (dann einfach noch einmal speichern). Nur Passwörter und Dateien müssen neu eingegeben bzw. gewählt werden.
* **Entwurf:** Längere Formulare (Kunde, Fahrzeug, Termin, Reifensatz, Rechnung, Mitarbeiter) merken sich Ihre Eingabe in diesem Browser-Tab. Schließen Sie
  das Formular versehentlich, finden Sie sie beim erneuten Öffnen wieder („Der nicht gespeicherte Entwurf wurde wiederhergestellt“, mit **Entwurf
  verwerfen**). Erst nach dem **erfolgreichen** Speichern ist der Entwurf gelöscht – scheitert das Speichern (Fehler, abgelaufene Anmeldung, keine Verbindung), bleibt er stehen. Entwürfe gehören
  Ihrem Benutzerkonto: Beim Abmelden und auf der Anmeldeseite werden alle gelöscht, ein anderer Benutzer am selben Gerät sieht sie nie. Ein Entwurf passt nur zur selben Ausgangslage
  (z. B. einem Termin zur selben Uhrzeit im Kalender); öffnen Sie das Formular mit anderen Vorgaben, beginnt es neu. Passwörter und die sensiblen Mitarbeiterfelder (Notfallkontakt) werden nie gemerkt.
* **Enter** in einem Textfeld speichert wie der Hauptknopf – nie „Speichern und weiter“.
* **Speichern und weiter:** Beim Anlegen eines Kunden führt **Speichern und Fahrzeug anlegen** direkt zum Fahrzeugformular – der neue Kunde ist schon als Halter eingetragen. Den Knopf gibt es nur, wenn Sie Fahrzeuge anlegen dürfen.
* **Dateien:** Zu große Dateien werden schon beim Auswählen abgelehnt („Datei zu groß (max. 10 MB)“), nicht erst nach dem Hochladen.
* **Fenster mit Eingaben** (z. B. ein Termin im Kalender) fragen beim Schließen „Änderungen verwerfen?“, wenn Sie schon etwas eingegeben haben; **Verwerfen** löscht auch den Entwurf. Nach jeder Rückfrage steht der Fokus wieder auf dem Knopf, der sie geöffnet hat.
* Die Speichern-Leiste bleibt am unteren Rand sichtbar, solange das Formular länger als der Bildschirm ist; auf dem Handy rückt sie mit geöffneter Tastatur nach oben aus dem Weg.

## Rückfragen und Rückmeldung

* **Löschen und andere folgenreiche Aktionen** (Backup wiederherstellen, Update installieren, Funktion ausschalten) fragen vorher in einem Fenster nach, das die
  Aktion benennt („Kunde löschen?“) und die Folgen erklärt. Beim **Wiederherstellen eines Backups** müssen Sie zur Bestätigung zusätzlich das Wort „wiederherstellen“
  eintippen. In Tabellen zeigen Löschen-Knöpfe auf dem Handy das Wort „Löschen“, am Desktop nur das Symbol (mit dem Wort als Hinweis beim Darüberfahren).
* Das Ergebnis meldet eine **Meldung unten im Bild** (über der Speichern-Leiste und dem Rand des Geräts): grün bei Erfolg (bleibt mindestens fünf Sekunden und
  hält an, solange Sie mit der Maus darauf sind), rot bei einem Fehler (bleibt, bis man sie schließt). Typische Fehler sind „Dieser Eintrag existiert nicht
  mehr“ (jemand anderes war schneller), „… wird noch verwendet“ (z. B. ein Kunde mit Fahrzeugen) oder ein fehlendes Recht.
* In Auswahlfeldern mit Suche (Kunde, Fahrzeug) wählen Sie mit den Pfeiltasten und Enter; Screenreader hören die Zahl der Treffer. Findet die
  Fahrzeugsuche nichts, bietet sie **Fahrzeug neu anlegen** an (mit dem Suchtext als Kennzeichen), sofern Sie Fahrzeuge anlegen dürfen. Schlägt die Suche selbst fehl, steht das
  im Feld.

## Listen, Suchen und Filtern

Die **Suche in der Kopfleiste** durchsucht alle Bereiche auf einmal (siehe „Die Oberfläche“ in „Erste Schritte“). Die Listen (Kunden, Fahrzeuge, Reifensätze, Rechnungen, Mitarbeiter, Fuhrpark, Geräte, Verkabelung, Benutzer, Audit-Log …) sind alle gleich aufgebaut:

* **Suchfeld und Filter** stehen oben. Die Suche findet Teile von Wörtern und ignoriert Groß-/Kleinschreibung, Umlaut-Schreibweise und Trenner: „müller“, „MÜLLER“, „mueller“ und „muller“ finden alle „Müller“, „strasse“ findet „Straße“, bei Kennzeichen („B AB-1234“ = „BAB1234“) und Telefonnummern („0171/123 456“ = „+49 171 123456“) spielen Leerzeichen, Bindestriche und die Landesvorwahl keine Rolle. Mehrere Wörter finden Treffer, die alle enthalten – in beliebiger Reihenfolge. Durchsucht werden nur Angaben, die Sie auch sehen dürfen. Die Liste **filtert beim Tippen** (kurz nach der letzten Eingabe) und beim Wählen eines Filters; während sie lädt, steht „Liste wird gefiltert …“ neben den Knöpfen. **Filter** oder Enter wenden den Filter sofort an. Ist ein Filter gesetzt, erscheint **Zurücksetzen** und leert die Felder. Auf dem Handy bleibt das Suchfeld immer sichtbar, die übrigen Filter stehen hinter **Weitere Filter**.
* **Sortieren:** Ein Klick auf eine Spaltenüberschrift mit Pfeil sortiert danach, ein zweiter Klick kehrt die Richtung um. Auf dem Handy stehen die sortierbaren Spalten als Auswahl über der Liste. Die gewählte Sortierung bleibt beim Suchen und Filtern erhalten.
* **Seiten:** Lange Listen zeigen 25 (Audit-Log 50) Einträge je Seite; unter der Liste stehen **Vorherige/Nächste Seite** und „26–50 von 80“. Die Zahl über der Liste ist immer die **Gesamtzahl** der Treffer, die Summen darüber (z. B. bei Rechnungen) gelten für alle Treffer des Zeitraums, nicht nur für die angezeigte Seite.
* **Ganze Zeile anklicken:** Ein Klick (oder Tippen) irgendwo in der Zeile öffnet den Eintrag; Links und Knöpfe in der Zeile (z. B. der Fahrer) behalten ihre eigene Wirkung.
* **Breite Tabellen** lassen sich seitlich wischen (oder per Tastatur: Passt die Tabelle nicht auf den Bildschirm, ist sie per Tab erreichbar, dann gehen die Pfeiltasten); ein Schatten und ein Hinweis zeigen, dass rechts noch Spalten folgen. Unter Tabletbreite wird jede Zeile zur **Karte** mit den wichtigsten Angaben.

## Orientierung

* Jede Seite eines einzelnen Eintrags (Ansehen, Bearbeiten, Neu anlegen) hat oben einen **Weg zurück** („← Kunden“, am Desktop als Pfad „Kunden › Müller“) – auch in einem auf dem Handy installierten Fenster ohne Zurück-Taste.
* Das **Fragezeichen** oben rechts öffnet das Hilfekapitel zur Seite.
* **Löschen** steht auf der Seite eines Eintrags im **Gefahrenbereich** am Ende, abgesetzt von den gewöhnlichen Aktionen; es fragt vorher nach.
* **Farben und Symbole:** Zustände zeigen eine Marke mit Symbol, nicht nur eine Farbe: grün (in Ordnung/erledigt), gelb (bald fällig/Aufmerksamkeit), rot (überfällig/Fehler), blau (in Arbeit/Information), grau (neutral).
* Die Hilfe gibt es nur auf Deutsch; bei englischer Oberfläche weist die Hilfeseite darauf hin. Lange Kapitel haben oben ein einklappbares Inhaltsverzeichnis („Auf dieser Seite“), am breiten Bildschirm steht es neben dem Text.

## Wenn etwas nicht klappt

* **„Seite nicht gefunden“:** Die Seite oder der Eintrag gibt es nicht (mehr), die Adresse stimmt nicht, oder die Funktion ist von der Administration ausgeschaltet. Die Navigation bleibt sichtbar, *Zur Übersicht* führt zurück.
* **„Kein Zugriff“:** Die Seite gibt es, aber Ihre Rolle darf sie nicht öffnen. Wer sie trotzdem braucht, wendet sich an die Administration (Rollen & Rechte).
* **„Das hat nicht geklappt“:** Beim Laden ist ein Fehler aufgetreten. *Erneut versuchen* lädt die Seite noch einmal; bleibt es dabei, die Administration informieren und die angezeigte Fehlerkennung nennen. Ein einzelner Baustein auf der Übersicht, der nicht lädt, stört die übrigen nicht.
* **Nach einem Update:** War die Seite während der Aktualisierung geöffnet, lädt sie sich beim nächsten Speichern einmal von selbst neu („Neue Version verfügbar“). Eingaben im geöffneten Formular gehen dabei verloren – danach noch einmal speichern. Passiert das kurz hintereinander ein zweites Mal, lädt die Seite nicht noch einmal selbst, sondern bittet darum, sie neu zu laden.
* **Wartezeit:** Dauert ein Seitenwechsel länger, erscheint am angeklickten Link ein kleines Lade-Symbol (ohne dass der Link sich verschiebt) und am oberen Rand ein dünner Fortschrittsbalken; Screenreader sagen „Wird geladen“ an. Ist in Ihrem Gerät „weniger Bewegung“ eingestellt, stehen Symbol und Balken still.
* **Handy und Tablet:** Auf Touch-Geräten und schmalen Bildschirmen sind Knöpfe und Felder größer (mindestens 44 Pixel), und Eingabefelder springen nicht von selbst auf. Kennzeichen und Fahrgestellnummer werden in Großbuchstaben getippt, ohne Autokorrektur.
