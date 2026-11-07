# Fahrzeuge

Fahrzeuge sind eigenständig und brauchen **keinen** Kunden. Erfasst werden Kennzeichen, Hersteller, Modell, Fahrgestellnummer, Baujahr und – für den Alltag der Werkstatt –
**Prüffristen**, Kilometerstand, Kraftstoff, Erstzulassung und die Schlüsselnummern (HSN/TSN) aus der Zulassungsbescheinigung.

## Kennzeichen vergeben? Das ist eine Warnung, keine Sperre

* Gibt es ein Kennzeichen schon, **speichert die Anwendung nicht stillschweigend** – sie warnt: Das Formular zeigt das vorhandene Fahrzeug mit seinem Halter und bietet
  **„Vorhandenes Fahrzeug öffnen“** (in einem neuen Tab, das ausgefüllte Formular bleibt offen), **„Trotzdem anlegen“** (bzw. „Trotzdem speichern“) und **„Altfahrzeug archivieren“** an: Das vorhandene Fahrzeug wird archiviert (es bleibt mit Historie, Terminen und Reifensätzen erhalten), und das neue wird gespeichert – beides in einem Schritt, mit zwei Einträgen im Audit-Log. Ein **archiviertes** Fahrzeug zählt nicht mehr als Dublette.
  Das gilt für Kundenfahrzeuge und genauso für **Firmenfahrzeuge** (Fuhrpark).
* **Neu seit dieser Version:** Früher war ein doppeltes Kennzeichen gesperrt. Jetzt lässt es sich nach Bestätigung speichern – etwa bei einem **wiederverwendeten Kennzeichen**
  oder wenn das **Altfahrzeug** noch erfasst ist. Die Bestätigung steht im Audit-Log („Dublette bestätigt“).
* Verglichen wird die **Schreibweise-unabhängige** Form: Groß-/Kleinschreibung, Leerzeichen, Bindestriche und Punkte spielen keine Rolle; Umlaute (Ä, Ö, Ü) zählen als Buchstaben,
  deutsche, österreichische und Schweizer Kennzeichen funktionieren gleich.

## Hauptuntersuchung / Prüfung fällig

* **„Hauptuntersuchung / Prüfung fällig“** ist ein **Monat** (z. B. 11/2026 – bei der HU der Monat der Plakette). Der Name ist bewusst neutral: Er passt zur HU in Deutschland, zum „Pickerl“ in Österreich
  und zur MFK in der Schweiz. Im Formular genügt ein Monatsfeld; wo der Browser keines anbietet, tippt man **11/2026** (auch 11.2026 oder 2026-11).
* Optional gibt es eine **weitere Prüfung** mit Art und Datum – zum Beispiel **Sicherheitsprüfung (SP)** oder **Gasanlagenprüfung**.
* Die Fahrzeugseite zeigt die Frist farbig: **rot = überfällig**, **gelb = im laufenden Monat oder in den nächsten zwei Monaten fällig**. Der Zustand steht auch in Worten
  („überfällig seit …“, „fällig im …“), nicht nur als Farbe.
* **Dashboard-Baustein „Prüfungen bald fällig“:** zeigt die Fahrzeuge mit überfälliger oder bald fälliger Prüfung, die dringendsten zuerst. Mit **„Termin planen“** öffnet sich das Terminformular
  mit bereits gewähltem Fahrzeug (nur, wenn die Funktion Termine aktiv ist und Sie Termine anlegen dürfen).

## Liste filtern und für Anrufe drucken

* In der Fahrzeugliste filtern Sie nach **Prüffrist**: *Bald fällig oder überfällig*, *Ohne Prüffrist* oder einem bestimmten **Monat** („Fällig im Monat“). Die Spalte „HU / Prüfung“ lässt sich sortieren.
* **„Druckliste“** druckt die **gefilterte** Liste als Tabelle mit Kennzeichen, Fahrzeug, Halter, **Telefon** und Frist – zum Abhaken beim Anrufen („Wer hat im November HU?“). Die Telefonnummer sehen nur
  Personen, die Kunden sehen dürfen. Es werden höchstens 1000 Fahrzeuge gedruckt.

## Weitere Angaben

* **Kilometerstand** (zuletzt bekannt; Tausenderpunkte sind erlaubt), **Kraftstoff** (Benzin, Diesel, Hybrid, Elektro, Autogas, Erdgas, Wasserstoff, Sonstiges),
  **Erstzulassung** und **HSN/TSN** (4 und 3 Zeichen, Felder 2.1 und 2.2 der Zulassungsbescheinigung).
* **Halter:** Auf der Fahrzeugseite steht der Name des Halters; seine **Telefonnummer** sehen nur Personen, die Kunden sehen dürfen (dasselbe gilt auf der Seite eines Reifensatzes).
* **Halterwechsel:** Über „Halterwechsel“ (Datum, optional Notiz) wechselt der Halter. Die **Historie** bleibt sichtbar; Reifensätze
  und Termine bleiben am Fahrzeug. **Offene Termine** des Fahrzeugs, die noch nicht vorbei sind (Geplant, Bestätigt, In Arbeit), bekommen ab dem Wechseltag den **neuen Halter**; erledigte, stornierte und vergangene Termine behalten den damaligen Kunden. Das Audit-Log nennt, wie viele Termine umgestellt wurden.

## Export und Import (CSV)

Über **Export / Import** oben in der Fahrzeugliste. Beides sind eigene Rechte (*Fahrzeuge exportieren*, *Fahrzeuge importieren*), die in keiner mitgelieferten Rolle enthalten sind. Der Export setzt zusätzlich das Recht zum Ansehen der Fahrzeuge voraus.

* **Archivieren und Löschen:** Auf der Fahrzeugseite steht unter „Gefahrenbereich“ zuerst, **was am Fahrzeug hängt** (Termine, Reifensätze, Halterwechsel). **Gelöscht** werden kann nur ein Fahrzeug **ohne Geschichte** – ein versehentlich angelegtes, an dem noch nichts hängt (sein erster Halter-Eintrag fällt dabei mit weg). Hängen Termine, Reifensätze oder ein Halterwechsel daran, ist Löschen gesperrt (die Halter-Historie verschwindet nie stillschweigend); dann **archivieren** (Recht „Fahrzeuge bearbeiten“): Das Fahrzeug bleibt mit Halter-Historie, Reifensätzen und Terminen erhalten, erscheint aber **nicht mehr in Auswahlfeldern, Suche, Schnellsuche, Neu-Formularen, im Baustein „Prüffrist“ und in der Dublettenwarnung**. Die Fahrzeugliste zeigt Archivierte im Filter **„Anzeigen“** (auch in Druckliste und CSV-Export, die dem Filter folgen); **„Wieder aktivieren“** macht das Fahrzeug wieder wählbar.
* **Export der gefilterten Liste:** Öffnen Sie den Export aus der Fahrzeugliste, übernimmt er deren Auswahl (Suche, Prüffrist, „ohne Halter“) – die Seite zeigt, was ausgewählt ist.
* **Dateiformat:** CSV (Textdatei mit Spalten). Für den Export wählen Sie zwischen **Excel (Deutschland)** – Semikolon als Trennzeichen, Komma als Dezimalzeichen, öffnet sich in deutschem Excel per Doppelklick – und **International** (Komma und Punkt). Die Datei ist UTF-8 mit Kennung, Umlaute erscheinen in Excel richtig. Datum steht als `JJJJ-MM-TT`, Beträge als Zahl ohne Währungszeichen (`1234,56`).
* **Schutz vor Formeln:** Zellen, die mit `=`, `+`, `-` oder `@` beginnen, bekommen im Export ein vorangestelltes `'`, damit Excel sie nie als Formel ausführt. Der Import nimmt dieses Zeichen wieder weg – ein Export lässt sich unverändert wieder einlesen. Beim Import werden solche Zellen nur als Text gespeichert und nie ausgeführt.

* **Spalten:** Kennzeichen (Pflicht), Hersteller, Modell, FIN, Baujahr, Kilometerstand, Kraftstoff, HSN, TSN, Erstzulassung, HU fällig (JJJJ-MM), Weitere Prüfung samt Datum, Notizen. Der **Halter** erscheint als **Kundennummer** – nur, wenn Sie Kunden sehen dürfen; beim Import ordnet die Kundennummer den Halter zu (unbekannte oder mehrfach vergebene Nummern sind Zeilenfehler). Kraftstoff und Art der weiteren Prüfung dürfen ausgeschrieben oder als Kennung stehen.
* **Dubletten:** Ein Kennzeichen, das es schon gibt (oder das weiter oben in der Datei steht), ist wie in der Oberfläche eine **Warnung**, keine Sperre: Die Zeile wird übersprungen – oder, wenn Sie **„Dubletten trotzdem anlegen“** wählen, bewusst angelegt.

**So läuft ein Import:** Datei wählen und **„Vorschau erstellen“** – es wird noch nichts gespeichert. Die Vorschau zeigt den erkannten Zeichensatz (UTF-8, Windows-1252 und UTF-16 werden erkannt) und das Trennzeichen, welche Spalten der Datei übernommen werden, die Meldung zu jeder auffälligen Zeile (mit Zeilennummer) und eine Zusammenfassung: **neu**, **Dubletten (übersprungen)** und **fehlerhaft**. Erst mit **„Jetzt importieren“** wird gespeichert – alle neuen Zeilen **in einem Schritt oder gar nicht**; bei einem Fehler bleibt der Bestand unverändert. Enthält die Datei fehlerhafte Zeilen, wird nichts importiert, solange Sie nicht **„Fehlerhafte Zeilen überspringen“** wählen. Der Import **legt nur neue Datensätze an** und ändert bestehende nie. Die Datei darf höchstens 5 MB und 5000 Zeilen haben und wird nur im Arbeitsspeicher verarbeitet, nicht gespeichert. Excel-Arbeitsmappen (.xlsx) werden nicht gelesen: in Excel „Speichern unter“ → „CSV UTF-8“ wählen.

**Datenschutz:** Die Datei enthält personenbezogene Daten. Geben Sie sie nur an Berechtigte weiter, versenden Sie sie nicht unverschlüsselt per E-Mail und löschen Sie sie, wenn Sie sie nicht mehr brauchen. Jeder Export und Import steht mit der Zahl der Zeilen im Audit-Log (Wer, wann, wie viele).
