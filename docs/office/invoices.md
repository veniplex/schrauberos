# Rechnungsarchiv

Das Rechnungsarchiv sammelt **Eingangsrechnungen** (von Lieferanten) und **Ausgangsrechnungen** (an Kunden) getrennt.

* **Erfassen:** Rechnungsnummer, Geschäftspartner, Datum, Fälligkeit, Beträge (Netto, MwSt., Brutto), Kategorie, Referenz und Notizen.
  Netto und MwSt. werden gegen den Bruttobetrag geprüft. Bei Ausgangsrechnungen lässt sich ein Kunde verknüpfen (im Formular erscheint sein Ort nur für Personen, die Kunden sehen dürfen).
* **Beleg:** Zur Rechnung kann ein Beleg (PDF, PNG, JPEG, WebP oder XML-E-Rechnung, bis 10 MB) hochgeladen werden. Die Anwendung prüft den Inhalt der Datei,
  nicht nur die Endung: Eine Datei, die sich als PDF ausgibt, aber etwas anderes ist, wird abgelehnt. Belege (PDF, Bilder) lassen sich im Browser ansehen (die **PDF-Vorschau** gibt es am Computer und erst nach Klick auf „Vorschau anzeigen“; auf Handy und Tablet bleiben „Öffnen“ und „Herunterladen“),
  XML-Dateien nur herunterladen. Ein Beleg kann ersetzt oder entfernt werden.
  **Fotos vom Handy** werden vor dem Hochladen automatisch verkleinert (längste Seite 1600 Pixel, als JPEG) – ein Foto von 6 MB wird so zu weit unter 1 MB und passt auch bei schlechtem Netz. Auf dem Handy gibt es zusätzlich „Foto aufnehmen“ für die Kamera.
  PDF-Dateien bleiben unverändert. Liegt das Foto im Format HEIC vor und der Browser kann es nicht umwandeln (Chrome auf Android), erscheint ein Hinweis: bitte als JPEG aufnehmen oder speichern (iPhone: Einstellungen › Kamera › Formate › „Maximale Kompatibilität“).
* **Status:** Offen, Bezahlt oder Storniert. „Überfällig“ ergibt sich automatisch aus der Fälligkeit. Mit „Als bezahlt markieren“
  lässt sich eine Rechnung schnell abschließen.
* **Eingangsrechnungen** lassen sich jederzeit ändern und löschen; jede Änderung steht im Audit-Log.
* **Doppelte Rechnungen** (gleiche Nummer beim selben Partner) werden abgelehnt. **Ausgangsrechnungsnummern sind eindeutig:** Dieselbe Nummer
  darf es nur einmal geben, egal bei welchem Kunden – Groß-/Kleinschreibung und überzählige Leerzeichen zählen nicht als Unterschied
  („re 2026-1“ und „RE  2026-1“ sind dieselbe Nummer). Bei Eingangsrechnungen vergibt der Lieferant die Nummern; hier gilt nur die Regel mit dem Partner.
* **Rückmeldung:** „Als bezahlt markieren“, „Wieder öffnen“ und „Löschen“ melden ihr Ergebnis oben auf der Seite.
* **Summen:** Je Richtung und Jahr, dazu die offenen Beträge auf der Übersicht.

## Belege aus „Angebote & Rechnungen“

Ist die Funktion *Angebote & Rechnungen* eingeschaltet, stehen die dort **festgeschriebenen** Rechnungen (auch Abschlags-, Schluss- und Stornorechnungen) in der Ausgangsliste – zusammen mit den von Hand erfassten. Angebote, Auftragsbestätigungen und Entwürfe gehören nicht dazu. Solche Belege bearbeiten Sie nicht hier: Die Rechnungsseite zeigt sie an und führt mit „Im Rechnungsarchiv“/„Beleg in der Rechnungserstellung öffnen“ dorthin (Positionen, Zahlungen, XRechnung, Versand). Eine **Stornorechnung** legen Sie auch hier an; bei diesen Belegen vergibt die Anwendung die Nummer selbst und setzt das heutige Datum. Ist die Funktion *Angebote & Rechnungen* ausgeschaltet, setzen Sie den Zahlstatus ihrer Rechnungen weiter hier („Als bezahlt markieren“).

## Festschreiben und Stornorechnung (Ausgangsrechnungen)

Das Rechnungsarchiv ist eine Ablage, kein Rechnungsprogramm. Damit eine ausgestellte Rechnung nicht versehentlich verändert oder gelöscht wird, lässt sich eine **Ausgangsrechnung festschreiben** – freiwillig, mit dem Recht *Ausgangsrechnungen festschreiben*. Dieses Recht steht in keiner mitgelieferten Rolle; ein Administrator vergibt es bewusst.

* **Nicht festgeschriebene Ausgangsrechnungen** bleiben wie bisher änderbar und löschbar. Jede Änderung und jedes Löschen steht im Audit-Log.
* **Festschreiben** (Knopf auf der Rechnungsseite, mit Rückfrage): Danach sind Rechnungsnummer, Empfänger, Datum, Beträge, Kategorie, Notizen und der Beleg **unveränderlich**, und die Rechnung ist **nicht mehr löschbar**. Das lässt sich nicht rückgängig machen. Der **Zahlstatus** (bezahlt, wieder öffnen) bleibt änderbar; auch das steht im Audit-Log. Wer wann festgeschrieben hat, steht auf der Rechnungsseite.
* **Korrigieren per Stornorechnung:** Auf der Rechnungsseite legen Sie mit **„Stornorechnung anlegen“** einen **Gegenbeleg** an – eine eigene Rechnung mit Bezug auf die ursprüngliche: gleicher Empfänger, alle Beträge mit umgekehrtem Vorzeichen (negativ), eigene Nummer und eigenes Datum (leer = heute; ein Datum in der Zukunft ist nicht möglich), optional ein Grund. Die **Nummer der Stornorechnung tragen Sie ein**, wie bei jeder Ausgangsrechnung im Archiv; sie darf noch nicht vergeben sein. Die Stornorechnung ist selbst festgeschrieben. Die ursprüngliche Rechnung bleibt unverändert, gilt aber als **storniert**; beide zählen nicht mehr in den offenen Beträgen, und ihr Zahlstatus ist gesperrt. Eine Rechnung lässt sich nur einmal stornieren, eine Stornorechnung nicht noch einmal; Angebote und Auftragsbestätigungen lassen sich nicht stornieren. **Nummern werden nie wiederverwendet.** Für die richtige Rechnung legen Sie danach eine neue Ausgangsrechnung an.
* Eine Rechnung, die Sie nur als *Storniert* markiert, aber nicht festgeschrieben haben, bleibt änderbar – der Status *Storniert* ist dann nur eine Markierung ohne Gegenbeleg.
* Das gilt für Oberfläche **und** Programmierschnittstelle (`finalize`, `cancel`).

**Wichtig:** Das Festschreiben schützt vor Änderungen **in dieser Anwendung**. Es ersetzt keine Beratung durch Ihren Steuerberater und macht die Anwendung nicht zu einem zertifizierten Buchhaltungs- oder Kassensystem; ob und wie Sie Rechnungen aufbewahren müssen, klären Sie bitte mit ihm. Bei **Wiederherstellung eines älteren Backups** gilt der Stand des Backups: Rechnungen, Festschreibungen und Stornorechnungen, die danach entstanden sind, sind dann nicht mehr vorhanden (siehe Hilfe *Backups*). Bewahren Sie Rechnungsdateien, die Sie versenden, deshalb zusätzlich an anderer Stelle auf.

## E-Rechnung (XRechnung/ZUGFeRD-XML) als Eingangsbeleg

Wählen Sie bei einer **Eingangsrechnung** als Beleg eine **XML-Datei** im Format XRechnung oder ZUGFeRD (UBL `Invoice`/`CreditNote` oder CII `CrossIndustryInvoice`), liest die Anwendung die Datei und zeigt eine **Vorschau**: Rechnungsnummer, Datum, Fälligkeit, Lieferant, Netto, MwSt. und Brutto. **Nichts wird von selbst übernommen** – erst mit **„Vorschlag übernehmen“** füllen sich die Felder, die Sie prüfen und ändern können. Weicht die Währung von Euro ab, stimmen Netto + MwSt. nicht mit dem Brutto überein oder fehlen Angaben, steht ein Hinweis dabei; eine Gutschrift erscheint mit negativen Beträgen.

* Die **Original-Datei bleibt unverändert** als Beleg erhalten (nur zum Herunterladen, nicht zur Ansicht im Browser).
* Aus Sicherheitsgründen liest die Anwendung nur **einfache** E-Rechnungen: Dateien mit Dokumenttypdefinition (DTD), eigenen Entitäten oder Verarbeitungsanweisungen werden abgelehnt, ebenso zu große oder zu tief verschachtelte Dateien und alles, was nicht UTF-8 ist.
* Eine **ZUGFeRD-PDF** (PDF mit eingebettetem XML) wird als PDF abgelegt; die darin eingebettete XML-Datei liest die Anwendung nicht. Laden Sie dafür die XML-Datei hoch, wenn Sie sie haben.
* Die Anwendung prüft die Rechnung nicht fachlich (kein Validator für XRechnung/ZUGFeRD) und ersetzt keine Buchhaltung.

## Export und Import (CSV) und Steuerberater-Export

Über **Export / Import** oben im Rechnungsarchiv. Beides sind eigene Rechte (*Rechnungen exportieren*, *Rechnungen importieren*), die in keiner mitgelieferten Rolle enthalten sind. Der Export setzt zusätzlich das Recht zum Ansehen der Rechnungen voraus. **Belege (Dateien) sind nie Teil des Austauschs.**

* **Dateiformat:** CSV (Textdatei mit Spalten). Für den Export wählen Sie zwischen **Excel (Deutschland)** – Semikolon als Trennzeichen, Komma als Dezimalzeichen, öffnet sich in deutschem Excel per Doppelklick – und **International** (Komma und Punkt). Die Datei ist UTF-8 mit Kennung, Umlaute erscheinen in Excel richtig. Datum steht als `JJJJ-MM-TT`, Beträge als Zahl ohne Währungszeichen (`1234,56`).
* **Schutz vor Formeln:** Zellen, die mit `=`, `+`, `-` oder `@` beginnen, bekommen im Export ein vorangestelltes `'`, damit Excel sie nie als Formel ausführt. Der Import nimmt dieses Zeichen wieder weg – ein Export lässt sich unverändert wieder einlesen. Beim Import werden solche Zellen nur als Text gespeichert und nie ausgeführt.

* **Steuerberater-Export:** Wählen Sie den **Zeitraum** (Von/Bis nach Rechnungsdatum, mit Voreinstellungen wie *Letztes Quartal*) und ob **Eingangs-, Ausgangsrechnungen oder beide** enthalten sein sollen. Die Datei enthält Art, Rechnungsnummer, Rechnungsdatum, Geschäftspartner, Netto, MwSt., Brutto, Zahlstatus (*Offen*, *Überfällig*, *Bezahlt*, *Storniert*) und Bezahlt-am – ohne Belege, Kategorien, Notizen und Kunden. Stornierte Rechnungen stehen mit dem Zahlstatus *Storniert* darin. **Kunden mit eingeschränkter Verarbeitung (Datenschutz):** Ihre festgeschriebenen Rechnungen gehören wegen der Aufbewahrungspflicht in diese Übergabe – aber **ohne Namen**: Statt des Geschäftspartners steht die Kundennummer und „Verarbeitung eingeschränkt (Aufbewahrungspflicht)“. Der allgemeine CSV-Export der Rechnungen lässt diese Kunden ganz aus.
* **Export des Rechnungsarchivs:** alle Angaben des Rechnungsformulars, optional für einen Zeitraum und eine Richtung. Diese Datei lässt sich wieder importieren.
* **Import:** Pflicht sind Art (*Eingang*/*Ausgang*), Rechnungsnummer, Geschäftspartner, Rechnungsdatum und Brutto. Es gelten dieselben Prüfungen wie im Formular (Netto plus MwSt. ergeben das Brutto, die Fälligkeit liegt nicht vor dem Rechnungsdatum). Mit der Spalte **Kundennummer** (nur wenn Sie Kunden sehen dürfen) wird eine Ausgangsrechnung dem Kunden zugeordnet.
* **Festschreibung und Storno im Export:** Beide Exporte enthalten die Spalten *Festgeschrieben am* und *Storno zu Rechnung* (bei einer Stornorechnung die Nummer der stornierten Rechnung). Der Import liest diese Spalten nicht – eine importierte Rechnung ist nie festgeschrieben.
* **Dubletten:** Eine Ausgangsrechnung mit schon vergebener Rechnungsnummer und eine Eingangsrechnung mit gleicher Nummer beim gleichen Geschäftspartner werden übersprungen. Eine Ausgangsnummer lässt sich nie doppelt vergeben.

**So läuft ein Import:** Datei wählen und **„Vorschau erstellen“** – es wird noch nichts gespeichert. Die Vorschau zeigt den erkannten Zeichensatz (UTF-8, Windows-1252 und UTF-16 werden erkannt) und das Trennzeichen, welche Spalten der Datei übernommen werden, die Meldung zu jeder auffälligen Zeile (mit Zeilennummer) und eine Zusammenfassung: **neu**, **Dubletten (übersprungen)** und **fehlerhaft**. Erst mit **„Jetzt importieren“** wird gespeichert – alle neuen Zeilen **in einem Schritt oder gar nicht**; bei einem Fehler bleibt der Bestand unverändert. Enthält die Datei fehlerhafte Zeilen, wird nichts importiert, solange Sie nicht **„Fehlerhafte Zeilen überspringen“** wählen. Der Import **legt nur neue Datensätze an** und ändert bestehende nie. Die Datei darf höchstens 5 MB und 5000 Zeilen haben und wird nur im Arbeitsspeicher verarbeitet, nicht gespeichert. Excel-Arbeitsmappen (.xlsx) werden nicht gelesen: in Excel „Speichern unter“ → „CSV UTF-8“ wählen.

**Datenschutz:** Die Datei enthält personenbezogene Daten. Geben Sie sie nur an Berechtigte weiter, versenden Sie sie nicht unverschlüsselt per E-Mail und löschen Sie sie, wenn Sie sie nicht mehr brauchen. Jeder Export und Import steht mit der Zahl der Zeilen im Audit-Log (Wer, wann, wie viele).
