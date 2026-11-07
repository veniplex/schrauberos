# Dokumente & Fotos

Mit **Dokumente & Fotos** hängen Sie Fotos und PDF-Dokumente an ein **Fahrzeug** oder einen **Auftrag**: Annahmefotos, Schäden, Arbeitsschritte, Fahrzeugschein, Kostenvoranschlag. Die Funktion ist
standardmäßig ausgeschaltet; ein Administrator schaltet sie unter **Verwaltung → Module & Funktionen** ein. Sie braucht die Funktion **Fahrzeuge**; Dateien an Aufträgen gibt es, wenn **Aufträge** aktiv sind.

## Hochladen

* **Wo:** Auf der Seite eines Fahrzeugs und eines Auftrags steht die Karte **Dokumente & Fotos**. Die Übersicht **Dokumente & Fotos** im Menü zeigt alle Dateien, die Sie sehen dürfen (Suche, Filter nach Art).
* **Fotos:** **Fotos hinzufügen** wählt eine oder mehrere Dateien; am Handy gibt es zusätzlich **Foto aufnehmen** (Kamera). Vorher wählen Sie die **Art** (Foto, Annahme, Schaden, Arbeit …) und
  optional eine Beschriftung für die nächsten Fotos. Jedes Foto lässt sich danach einzeln beschriften. Das Handy verkleinert große Fotos vor dem Hochladen.
* **Warteschlange:** Es laden höchstens zwei Fotos gleichzeitig; jedes zeigt Fortschritt und Zustand. Bei schlechter Verbindung **Erneut versuchen** – die Anwendung erkennt ein schon angekommenes Foto
  und legt es **nicht doppelt** ab. Fehlgeschlagene und abgebrochene Fotos lassen sich einzeln wiederholen oder aus der Liste nehmen.
* **Dokumente:** **PDF-Dokument hinzufügen** lädt ein PDF hoch.
* **Erlaubt** sind JPEG und PNG (Fotos) und PDF; **nicht angenommen** werden HEIC/HEIF (am iPhone „Kompatibelste“ als Kameraformat wählen oder das Foto als JPEG teilen), SVG, GIF und WebP.
  Eine Datei darf höchstens **10 MB** haben; ein Foto höchstens **50 Megapixel** (Breite × Höhe). Pro Fahrzeug oder Auftrag sind bis zu 300 Dateien möglich.
* **Prüfung:** Die Anwendung erkennt den Dateityp am **Inhalt**, nicht am Namen oder am gemeldeten Typ; eine Datei, die nicht zu ihrem Typ passt, wird abgewiesen.

## Standortdaten werden entfernt

Handyfotos tragen oft **Aufnahmeort (GPS), Kamera und Uhrzeit** in ihren Metadaten (Exif). Beim Hochladen **entfernt der Server diese Angaben** aus jedem Foto – auch bei Fotos, die über die Programmierschnittstelle
kommen. Ebenfalls entfernt werden XMP-Daten, Kommentare und angehängte Zusatzdaten. Die **Drehung** des Fotos bleibt erhalten, damit es richtig herum angezeigt wird. Das Bild selbst wird dabei nicht neu
kodiert. Hinweis: **PDF-Dokumente** werden unverändert abgelegt (ihre Dokumenteigenschaften bleiben).

## Wer sieht was

* Dateien an einem **Fahrzeug** sehen Sie nur, wenn Sie das Recht zum Ansehen **von Fahrzeugen** haben; Dateien an einem **Auftrag** nur mit dem Recht zum Ansehen **von Aufträgen**. Dazu kommt das Recht
  **Dokumente und Fotos ansehen**. Wer das Fahrzeug oder den Auftrag nicht sehen darf, sieht auch dessen Dateien nicht.
* **Datenschutz:** Bei Kunden mit **eingeschränkter Verarbeitung** (Art. 18 DSGVO) sind die Dateien ihrer Fahrzeuge und Aufträge **nicht sichtbar** und es lassen sich keine neuen anhängen.
* **Uploaden** darf, wer das Recht **Fotos und Dokumente hochladen** hat – nicht an einem **archivierten Fahrzeug** und nur an **offenen Aufträgen** (Angenommen, In Arbeit, Fertig). Ein abgeschlossener
  Auftrag ändert sich nur über „Wieder öffnen“; seine Dateien lassen sich nur ansehen.

## Entfernen

**Entfernen** (mit Rückfrage) nimmt eine Datei aus der Anzeige und aus der Auslieferung. Entfernen darf, wer die Datei selbst hochgeladen hat, und – wer das Recht **Dokumente und Fotos aller entfernen** hat (die
Leitung) – jede Datei. Die gespeicherte Datei wird dabei **nicht überschrieben oder gelöscht**; sie bleibt unverändert auf dem Datenträger (so funktionieren auch die Sicherungen), und die Entfernung steht im Audit-Log. Ein Fahrzeug
mit Dateien lässt sich deshalb nicht löschen, sondern nur archivieren.

## Datenschutz: Auskunft und Anonymisierung

Die **Auskunft** für einen Kunden listet die Dateien an seinen Fahrzeugen und Aufträgen (Name, Beschriftung, Art, Fahrzeug/Auftrag, Datum) – nicht ihren Inhalt. Bei der **Anonymisierung** eines Kunden
werden Beschriftungen und Dateinamen dieser Dateien unkenntlich gemacht. **Die Dateien selbst bleiben unverändert liegen** – ein Foto kann dennoch Personen oder Dokumente zeigen. Soll das nicht bleiben, entfernen
Sie die Dateien vorher am Fahrzeug bzw. Auftrag.

## Handy und Tablet

Der Kamera-Knopf, die Warteschlange und die Aktionen unter jedem Foto haben große Ziele. Bei unterbrochener Verbindung bleiben nicht hochgeladene Fotos in der Liste und lassen sich wiederholen, solange die
Seite offen ist.
