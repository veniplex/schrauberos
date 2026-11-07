# Rechnungsarchiv

Das Rechnungsarchiv sammelt **Eingangsrechnungen** (von Lieferanten) und **Ausgangsrechnungen** (an Kunden) getrennt.

* **Erfassen:** Rechnungsnummer, Geschäftspartner, Datum, Fälligkeit, Beträge (Netto, MwSt., Brutto), Kategorie, Referenz und Notizen.
  Netto und MwSt. werden gegen den Bruttobetrag geprüft. Bei Ausgangsrechnungen lässt sich ein Kunde verknüpfen.
* **Beleg:** Zur Rechnung kann ein Beleg (PDF, PNG, JPEG, WebP oder XML-E-Rechnung, bis 10 MB) hochgeladen werden. Die Anwendung prüft den Inhalt der Datei,
  nicht nur die Endung: Eine Datei, die sich als PDF ausgibt, aber etwas anderes ist, wird abgelehnt. Belege (PDF, Bilder) lassen sich im Browser ansehen (die **PDF-Vorschau** gibt es am Computer und erst nach Klick auf „Vorschau anzeigen“; auf Handy und Tablet bleiben „Öffnen“ und „Herunterladen“),
  XML-Dateien nur herunterladen. Ein Beleg kann ersetzt oder entfernt werden.
  **Fotos vom Handy** werden vor dem Hochladen automatisch verkleinert (längste Seite 1600 Pixel, als JPEG) – ein Foto von 6 MB wird so zu weit unter 1 MB und passt auch bei schlechtem Netz. Auf dem Handy gibt es zusätzlich „Foto aufnehmen“ für die Kamera.
  PDF-Dateien bleiben unverändert. Liegt das Foto im Format HEIC vor und der Browser kann es nicht umwandeln (Chrome auf Android), erscheint ein Hinweis: bitte als JPEG aufnehmen oder speichern (iPhone: Einstellungen › Kamera › Formate › „Maximale Kompatibilität“).
* **Status:** Offen, Bezahlt oder Storniert. „Überfällig“ ergibt sich automatisch aus der Fälligkeit. Mit „Als bezahlt markieren“
  lässt sich eine Rechnung schnell abschließen.
* **Doppelte Rechnungen** (gleiche Nummer beim selben Partner) werden abgelehnt. **Ausgangsrechnungsnummern sind eindeutig:** Dieselbe Nummer
  darf es nur einmal geben, egal bei welchem Kunden – Groß-/Kleinschreibung und überzählige Leerzeichen zählen nicht als Unterschied
  („re 2026-1“ und „RE  2026-1“ sind dieselbe Nummer). Bei Eingangsrechnungen vergibt der Lieferant die Nummern; hier gilt nur die Regel mit dem Partner.
* **Rückmeldung:** „Als bezahlt markieren“, „Wieder öffnen“ und „Löschen“ melden ihr Ergebnis oben auf der Seite.
* **Summen:** Je Richtung und Jahr, dazu die offenen Beträge auf der Übersicht.

## Export und Import (CSV) und Steuerberater-Export

Über **Export / Import** oben im Rechnungsarchiv. Beides sind eigene Rechte (*Rechnungen exportieren*, *Rechnungen importieren*), die in keiner mitgelieferten Rolle enthalten sind. Der Export setzt zusätzlich das Recht zum Ansehen der Rechnungen voraus. **Belege (Dateien) sind nie Teil des Austauschs.**

* **Dateiformat:** CSV (Textdatei mit Spalten). Für den Export wählen Sie zwischen **Excel (Deutschland)** – Semikolon als Trennzeichen, Komma als Dezimalzeichen, öffnet sich in deutschem Excel per Doppelklick – und **International** (Komma und Punkt). Die Datei ist UTF-8 mit Kennung, Umlaute erscheinen in Excel richtig. Datum steht als `JJJJ-MM-TT`, Beträge als Zahl ohne Währungszeichen (`1234,56`).
* **Schutz vor Formeln:** Zellen, die mit `=`, `+`, `-` oder `@` beginnen, bekommen im Export ein vorangestelltes `'`, damit Excel sie nie als Formel ausführt. Der Import nimmt dieses Zeichen wieder weg – ein Export lässt sich unverändert wieder einlesen. Beim Import werden solche Zellen nur als Text gespeichert und nie ausgeführt.

* **Steuerberater-Export:** Wählen Sie den **Zeitraum** (Von/Bis nach Rechnungsdatum, mit Voreinstellungen wie *Letztes Quartal*) und ob **Eingangs-, Ausgangsrechnungen oder beide** enthalten sein sollen. Die Datei enthält Art, Rechnungsnummer, Rechnungsdatum, Geschäftspartner, Netto, MwSt., Brutto, Zahlstatus (*Offen*, *Überfällig*, *Bezahlt*, *Storniert*) und Bezahlt-am – ohne Belege, Kategorien, Notizen und Kunden. Stornierte Rechnungen stehen mit dem Zahlstatus *Storniert* darin.
* **Export des Rechnungsarchivs:** alle Angaben des Rechnungsformulars, optional für einen Zeitraum und eine Richtung. Diese Datei lässt sich wieder importieren.
* **Import:** Pflicht sind Art (*Eingang*/*Ausgang*), Rechnungsnummer, Geschäftspartner, Rechnungsdatum und Brutto. Es gelten dieselben Prüfungen wie im Formular (Netto plus MwSt. ergeben das Brutto, die Fälligkeit liegt nicht vor dem Rechnungsdatum). Mit der Spalte **Kundennummer** (nur wenn Sie Kunden sehen dürfen) wird eine Ausgangsrechnung dem Kunden zugeordnet.
* **Dubletten:** Eine Ausgangsrechnung mit schon vergebener Rechnungsnummer und eine Eingangsrechnung mit gleicher Nummer beim gleichen Geschäftspartner werden übersprungen. Eine Ausgangsnummer lässt sich nie doppelt vergeben.

**So läuft ein Import:** Datei wählen und **„Vorschau erstellen“** – es wird noch nichts gespeichert. Die Vorschau zeigt den erkannten Zeichensatz (UTF-8, Windows-1252 und UTF-16 werden erkannt) und das Trennzeichen, welche Spalten der Datei übernommen werden, die Meldung zu jeder auffälligen Zeile (mit Zeilennummer) und eine Zusammenfassung: **neu**, **Dubletten (übersprungen)** und **fehlerhaft**. Erst mit **„Jetzt importieren“** wird gespeichert – alle neuen Zeilen **in einem Schritt oder gar nicht**; bei einem Fehler bleibt der Bestand unverändert. Enthält die Datei fehlerhafte Zeilen, wird nichts importiert, solange Sie nicht **„Fehlerhafte Zeilen überspringen“** wählen. Der Import **legt nur neue Datensätze an** und ändert bestehende nie. Die Datei darf höchstens 5 MB und 5000 Zeilen haben und wird nur im Arbeitsspeicher verarbeitet, nicht gespeichert. Excel-Arbeitsmappen (.xlsx) werden nicht gelesen: in Excel „Speichern unter“ → „CSV UTF-8“ wählen.

**Datenschutz:** Die Datei enthält personenbezogene Daten. Geben Sie sie nur an Berechtigte weiter, versenden Sie sie nicht unverschlüsselt per E-Mail und löschen Sie sie, wenn Sie sie nicht mehr brauchen. Jeder Export und Import steht mit der Zahl der Zeilen im Audit-Log (Wer, wann, wie viele).
