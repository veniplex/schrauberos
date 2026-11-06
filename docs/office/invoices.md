# Rechnungsarchiv

Das Rechnungsarchiv sammelt **Eingangsrechnungen** (von Lieferanten) und **Ausgangsrechnungen** (an Kunden) getrennt.

* **Erfassen:** Rechnungsnummer, Geschäftspartner, Datum, Fälligkeit, Beträge (Netto, MwSt., Brutto), Kategorie, Referenz und Notizen.
  Netto und MwSt. werden gegen den Bruttobetrag geprüft. Bei Ausgangsrechnungen lässt sich ein Kunde verknüpfen.
* **Beleg:** Zur Rechnung kann ein Beleg (PDF, PNG, JPEG, WebP oder XML-E-Rechnung, bis 10 MB) hochgeladen werden. Die Anwendung prüft den Inhalt der Datei,
  nicht nur die Endung: Eine Datei, die sich als PDF ausgibt, aber etwas anderes ist, wird abgelehnt. Belege (PDF, Bilder) lassen sich im Browser ansehen,
  XML-Dateien nur herunterladen. Ein Beleg kann ersetzt oder entfernt werden.
* **Status:** Offen, Bezahlt oder Storniert. „Überfällig“ ergibt sich automatisch aus der Fälligkeit. Mit „Als bezahlt markieren“
  lässt sich eine Rechnung schnell abschließen.
* **Doppelte Rechnungen** (gleiche Nummer beim selben Partner) werden abgelehnt. **Ausgangsrechnungsnummern sind eindeutig:** Dieselbe Nummer
  darf es nur einmal geben, egal bei welchem Kunden – Groß-/Kleinschreibung und überzählige Leerzeichen zählen nicht als Unterschied
  („re 2026-1“ und „RE  2026-1“ sind dieselbe Nummer). Bei Eingangsrechnungen vergibt der Lieferant die Nummern; hier gilt nur die Regel mit dem Partner.
* **Rückmeldung:** „Als bezahlt markieren“, „Wieder öffnen“ und „Löschen“ melden ihr Ergebnis oben auf der Seite.
* **Summen:** Je Richtung und Jahr, dazu die offenen Beträge auf der Übersicht.
