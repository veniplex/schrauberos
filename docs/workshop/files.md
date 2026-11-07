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
kommen. Ebenfalls entfernt werden XMP-Daten, Kommentare und angehängte Zusatzdaten: Der Server behält nur ausdrücklich bekannte, in Länge und Aufbau geprüfte Teile (Bilddaten, Tabellen, Farbprofil, Drehung); Unbekanntes fällt weg oder die Datei wird als beschädigt abgelehnt. Die **Drehung** des Fotos bleibt erhalten, damit es richtig herum angezeigt wird. Das Bild selbst wird dabei nicht neu
kodiert. Hinweis: **PDF-Dokumente** werden unverändert abgelegt (ihre Dokumenteigenschaften bleiben).

## Wer sieht was

* Dateien an einem **Fahrzeug** sehen Sie nur, wenn Sie das Recht zum Ansehen **von Fahrzeugen** haben; Dateien an einem **Auftrag** nur mit dem Recht zum Ansehen **von Aufträgen**. Dazu kommt das Recht
  **Dokumente und Fotos ansehen**. Wer das Fahrzeug oder den Auftrag nicht sehen darf, sieht auch dessen Dateien nicht.
* **Datenschutz:** Bei Kunden mit **eingeschränkter Verarbeitung** (Art. 18 DSGVO) sind die Dateien ihrer Fahrzeuge und Aufträge **nicht sichtbar** und es lassen sich keine neuen anhängen.
* **Uploaden** darf, wer das Recht **Fotos und Dokumente hochladen** hat – nicht an einem **archivierten Fahrzeug** und nur an **offenen Aufträgen** (Angenommen, In Arbeit, Fertig). Ein abgeschlossener
  Auftrag ändert sich nur über „Wieder öffnen“; seine Dateien lassen sich nur ansehen.

## Entfernen

**Entfernen** (mit Rückfrage) nimmt eine Datei aus der Anzeige und aus der Auslieferung. Entfernen darf, wer die Datei selbst hochgeladen hat, und – wer das Recht **Dokumente und Fotos aller entfernen** hat (die
Leitung) – jede Datei. Die gespeicherte Datei wird dabei **nicht sofort gelöscht**; sie bleibt unverändert auf dem Datenträger (ein Versehen lässt sich so nachvollziehen), und die Entfernung steht im Audit-Log. **Nach 30 Tagen** löst ein
nächtlicher Lauf entfernte Dateien endgültig vom Datenträger (die Anzeige in der Übersicht der Aufgaben heißt „Entfernte Dateien endgültig löschen“); Sicherungen behalten ihre eigene Kopie bis zu ihrer Aufbewahrung. Bis dahin zählt eine
entfernte Datei im **Höchstwert von 300 Dateien** je Fahrzeug bzw. Auftrag mit. Beschriften und Entfernen darf, wer dazu berechtigt ist, **auch ohne das Recht zum Hochladen** – an einem archivierten Fahrzeug ebenfalls, an einem
abgeschlossenen Auftrag nicht. Ein Fahrzeug mit Dateien lässt sich nicht löschen, sondern nur archivieren.

## Datenschutz: Auskunft und Anonymisierung

Die **Auskunft** für einen Kunden listet die Dateien an seinen Fahrzeugen und Aufträgen (Name, Beschriftung, Art, Fahrzeug/Auftrag, Datum) – nicht ihren Inhalt. Bei der **Anonymisierung** eines Kunden
werden Beschriftungen und Dateinamen dieser Dateien unkenntlich gemacht – **auch dann, wenn die Funktion Dokumente & Fotos gerade ausgeschaltet ist** (die Daten bleiben beim Ausschalten erhalten). **Die Dateien selbst bleiben unverändert liegen** – ein Foto kann dennoch
Personen oder Dokumente zeigen. Soll das nicht bleiben, entfernen Sie die Dateien vorher am Fahrzeug bzw. Auftrag; sie werden 30 Tage später endgültig gelöscht.

## Handy und Tablet

Der Kamera-Knopf, die Warteschlange und die Aktionen unter jedem Foto haben große Ziele. Bei unterbrochener Verbindung bleiben nicht hochgeladene Fotos in der Liste und lassen sich wiederholen, solange die
Seite offen ist.
