# Kunden

Kundenstammdaten: Name oder Firma, Kundennummer, Kontakt und Adresse. Auf der Kundenseite stehen die Fahrzeuge des Kunden mit
ihren Reifensätzen sowie die letzten Termine.

**Neuer Kunde:** Mit **Speichern und Fahrzeug anlegen** geht es nach dem Speichern direkt zum Fahrzeugformular – der neue Kunde ist dort schon als Halter eingetragen. Der Knopf erscheint nur, wenn Sie Fahrzeuge anlegen dürfen.

**Suche:** Die Kundenliste findet nach Name, Firma, Kundennummer, Ort, Telefon, E-Mail-Adresse und (wenn Sie Fahrzeuge sehen dürfen) Kennzeichen.

**Löschen:** Ein Kunde lässt sich nur löschen, solange nichts mehr an ihm hängt – also **keine Fahrzeuge**, **keine Halter-Einträge** und **keine Rechnungen**. So bleibt nachvollziehbar, wem ein Fahrzeug gehörte und an wen eine Rechnung ging. Statt der Schaltfläche „Kunde löschen“ steht dann ein Hinweis mit den Zahlen: aktuelle Fahrzeuge, Halter-Einträge und Rechnungen. **Ein Halterwechsel hebt die Sperre nicht auf:** Die Halter-Historie des Fahrzeugs bleibt bestehen, der frühere Halter ist also weiter verknüpft. Löschen lassen sich deshalb nur Kunden, die nie Halter eines Fahrzeugs waren und zu denen es keine Rechnung gibt (z. B. versehentlich doppelt angelegte). Rechnungen lassen sich im Rechnungsarchiv entfernen. Eine Funktion zum Anonymisieren (Daten entfernen, Verknüpfungen behalten) gibt es noch nicht. Termine verhindern das Löschen nicht; sie verlieren nur die Verknüpfung zum Kunden.

## Export und Import (CSV)

Über **Export / Import** oben in der Kundenliste. Beides sind eigene Rechte (*Kunden exportieren*, *Kunden importieren*), die in keiner mitgelieferten Rolle enthalten sind – ein Administrator vergibt sie gezielt in der Rollenverwaltung. Für den Export wird zusätzlich das Recht zum Ansehen der Kunden gebraucht.

* **Dateiformat:** CSV (Textdatei mit Spalten). Für den Export wählen Sie zwischen **Excel (Deutschland)** – Semikolon als Trennzeichen, Komma als Dezimalzeichen, öffnet sich in deutschem Excel per Doppelklick – und **International** (Komma und Punkt). Die Datei ist UTF-8 mit Kennung, Umlaute erscheinen in Excel richtig. Datum steht als `JJJJ-MM-TT`, Beträge als Zahl ohne Währungszeichen (`1234,56`).
* **Schutz vor Formeln:** Zellen, die mit `=`, `+`, `-` oder `@` beginnen, bekommen im Export ein vorangestelltes `'`, damit Excel sie nie als Formel ausführt. Der Import nimmt dieses Zeichen wieder weg – ein Export lässt sich unverändert wieder einlesen. Beim Import werden solche Zellen nur als Text gespeichert und nie ausgeführt.

* **Spalten:** Kundennummer, Vorname, Nachname, Firma, E-Mail, Telefon, Straße, PLZ, Ort, Notizen. Beim Import dürfen die Überschriften deutsch oder englisch sein; unbekannte Spalten werden ignoriert. Pflicht ist Nachname oder Firma.
* **Dubletten:** Gleiche Kundennummer, gleiche E-Mail-Adresse mit gleichem Namen oder gleicher Name mit gleicher Anschrift gelten als Dublette. Sie werden übersprungen, auch wenn sie in der Datei mehrfach vorkommen.

**So läuft ein Import:** Datei wählen und **„Vorschau erstellen“** – es wird noch nichts gespeichert. Die Vorschau zeigt den erkannten Zeichensatz (UTF-8, Windows-1252 und UTF-16 werden erkannt) und das Trennzeichen, welche Spalten der Datei übernommen werden, die Meldung zu jeder auffälligen Zeile (mit Zeilennummer) und eine Zusammenfassung: **neu**, **Dubletten (übersprungen)** und **fehlerhaft**. Erst mit **„Jetzt importieren“** wird gespeichert – alle neuen Zeilen **in einem Schritt oder gar nicht**; bei einem Fehler bleibt der Bestand unverändert. Enthält die Datei fehlerhafte Zeilen, wird nichts importiert, solange Sie nicht **„Fehlerhafte Zeilen überspringen“** wählen. Der Import **legt nur neue Datensätze an** und ändert bestehende nie. Die Datei darf höchstens 5 MB und 5000 Zeilen haben und wird nur im Arbeitsspeicher verarbeitet, nicht gespeichert. Excel-Arbeitsmappen (.xlsx) werden nicht gelesen: in Excel „Speichern unter“ → „CSV UTF-8“ wählen.

**Datenschutz:** Die Datei enthält personenbezogene Daten. Geben Sie sie nur an Berechtigte weiter, versenden Sie sie nicht unverschlüsselt per E-Mail und löschen Sie sie, wenn Sie sie nicht mehr brauchen. Jeder Export und Import steht mit der Zahl der Zeilen im Audit-Log (Wer, wann, wie viele).
