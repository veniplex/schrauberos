# Reifenlager

Das Reifenlager ist die digitale Reifenliste: welche Reifen eines Fahrzeugs wo eingelagert sind und in welchem Zustand.

* **Reifensatz einlagern:** Fahrzeug wählen, Saison (Sommer, Winter, Ganzjahr), Marke, Größe, Felgenart und Lagerort eintragen. Je
  Position (vorne links/rechts, hinten links/rechts, Ersatzrad) lassen sich **DOT-Nummer**, **Profiltiefe** und **Zustand** erfassen.
  Der DOT-Code besteht aus vier Ziffern von der Reifenflanke, z. B. `2321` = Woche 23 des Jahres 2021; daraus wird das Alter berechnet.
* **Ampel:** Je Reifen und Satz zeigt die Anwendung *In Ordnung*, *Bald erneuern* oder *Erneuern* – nach Profiltiefe, Alter und
  Zustand. Die Grenzwerte stellt ein Administrator unter **Einstellungen → Reifenlager** ein.
* **Wechsel fällig:** Auf der Übersicht erscheinen Sätze, die zur aktuellen Saison montiert werden sollten und noch keinen Termin
  haben. Von dort lässt sich direkt ein Termin planen. Welche Saison gerade passt, bestimmt das **Winterfenster** unter
  **Einstellungen → Reifenlager** (Standard: Oktober bis März Winter, sonst Sommer; es darf über den Jahreswechsel gehen, aber nicht das ganze Jahr
  umfassen). **Ganzjahressätze** passen immer und lösen weder „Wechsel fällig“ noch einen Hinweis aus.
* **Falsche Saison:** Ein Satz, der **beim Kunden montiert** ist, aber nicht zur Jahreszeit passt (Sommerreifen mitten im Winter und umgekehrt),
  trägt in der Liste die Marke „Falsche Saison“, hat den Filter **Falsche Saison** und erscheint auf der Übersicht im Baustein „Falsche Saison montiert“.
  Es ist ein Hinweis, keine Sperre.
* **Status eines Satzes:**
  * **Eingelagert:** der Satz liegt im Lager.
  * **Ausgelagert (beim Kunden montiert):** der Satz ist aus dem Lager genommen und am Fahrzeug des Kunden montiert.
  * **Entsorgt:** der Satz gibt es nicht mehr.
* **Ein- und Ausbuchen:** Auf der Seite eines Satzes bucht **Ausbuchen (beim Kunden montiert)** den Satz aus dem Lager, **Wieder einbuchen** legt ihn zurück.
  Das dürfen alle mit dem Recht **Reifensätze ein-/ausbuchen** – bei den mitgelieferten Rollen Mechaniker, Serviceberater und Lager. Dieses Recht erlaubt
  **nicht**, den Satz zu bearbeiten, zu entsorgen oder zu löschen (das braucht „Reifensätze bearbeiten“ bzw. „löschen“). Hat jemand den Satz inzwischen schon
  umgebucht, meldet die Anwendung einen Konflikt, statt doppelt zu buchen; jede Buchung steht im Audit-Log. Ein entsorgter Satz lässt sich nicht buchen.
* **Nach einem erledigten Wechsel:** Wird ein Termin, der mit einem Satz verknüpft ist, auf **Fertig** gesetzt (Liste, Übersicht, Seite des Satzes), fragt die Anwendung
  **„Satz jetzt ausbuchen?“** (bzw. **„einbuchen?“**, wenn der Satz schon ausgelagert ist). Gebucht wird erst nach der Bestätigung – **Später** lässt alles, wie es ist.
  Wurde der Wechsel erledigt, der Satz aber nicht gebucht, weist seine Seite 30 Tage lang darauf hin. Die Frage erscheint nur mit dem Recht zum Ein-/Ausbuchen.

## Export und Import (CSV)

Über **Export / Import** oben im Reifenlager. Beides sind eigene Rechte (*Reifensätze exportieren*, *Reifensätze importieren*), die in keiner mitgelieferten Rolle enthalten sind. Der Export setzt zusätzlich das Recht zum Ansehen des Reifenlagers voraus.

* **Dateiformat:** CSV (Textdatei mit Spalten). Für den Export wählen Sie zwischen **Excel (Deutschland)** – Semikolon als Trennzeichen, Komma als Dezimalzeichen, öffnet sich in deutschem Excel per Doppelklick – und **International** (Komma und Punkt). Die Datei ist UTF-8 mit Kennung, Umlaute erscheinen in Excel richtig. Datum steht als `JJJJ-MM-TT`, Beträge als Zahl ohne Währungszeichen (`1234,56`).
* **Schutz vor Formeln:** Zellen, die mit `=`, `+`, `-` oder `@` beginnen, bekommen im Export ein vorangestelltes `'`, damit Excel sie nie als Formel ausführt. Der Import nimmt dieses Zeichen wieder weg – ein Export lässt sich unverändert wieder einlesen. Beim Import werden solche Zellen nur als Text gespeichert und nie ausgeführt.

* **Eine Zeile je Reifensatz.** Spalten: Kennzeichen (Pflicht, ordnet das Fahrzeug zu – es muss schon erfasst sein), Saison (Pflicht), Status, Marke, Modell, Breite, Querschnitt, Felge, Tragfähigkeits- und Geschwindigkeitsindex, Felgenart, Lagerort, Eingelagert am, Notizen und je Position (vorne links, vorne rechts, hinten links, hinten rechts, Ersatzrad) **DOT**, **Profil (mm)** und **Zustand**. Ein Ersatzrad entsteht, sobald eine seiner Spalten gefüllt ist. Der Export lässt sich nach Status einschränken. Kundendaten stehen nicht in der Datei.
* **Dubletten:** Ein Satz gleicher Saison, Marke, Modell und Größe am selben Fahrzeug (nicht entsorgt) ist eine Dublette: Er wird übersprungen oder – mit **„Dubletten trotzdem anlegen“** – bewusst angelegt. Ein Kennzeichen ohne passendes Fahrzeug oder mit mehreren Fahrzeugen ist ein Zeilenfehler.
* Excel entfernt führende Nullen: Ein dreistelliges DOT-Kürzel (`121` statt `0121`) wird beim Import wieder aufgefüllt.

**So läuft ein Import:** Datei wählen und **„Vorschau erstellen“** – es wird noch nichts gespeichert. Die Vorschau zeigt den erkannten Zeichensatz (UTF-8, Windows-1252 und UTF-16 werden erkannt) und das Trennzeichen, welche Spalten der Datei übernommen werden, die Meldung zu jeder auffälligen Zeile (mit Zeilennummer) und eine Zusammenfassung: **neu**, **Dubletten (übersprungen)** und **fehlerhaft**. Erst mit **„Jetzt importieren“** wird gespeichert – alle neuen Zeilen **in einem Schritt oder gar nicht**; bei einem Fehler bleibt der Bestand unverändert. Enthält die Datei fehlerhafte Zeilen, wird nichts importiert, solange Sie nicht **„Fehlerhafte Zeilen überspringen“** wählen. Der Import **legt nur neue Datensätze an** und ändert bestehende nie. Die Datei darf höchstens 5 MB und 5000 Zeilen haben und wird nur im Arbeitsspeicher verarbeitet, nicht gespeichert. Excel-Arbeitsmappen (.xlsx) werden nicht gelesen: in Excel „Speichern unter“ → „CSV UTF-8“ wählen.

## Etikett drucken

Auf der Seite eines Reifensatzes öffnet **Etikett** die Druckseite: ein Etikett mit **Kennzeichen**, **Lagerplatz**, Größe, Saison, Marke, dem **Namen des Halters** und dem Einlagerungsdatum. Telefon oder Anschrift stehen nie darauf. Der **QR-Code** enthält einen Link zur Seite des Satzes: Wer ihn mit der **Kamera des Handys** scannt, landet nach der Anmeldung direkt dort. Einen Scanner in der Anwendung gibt es nicht.

* **Formate:** 62 × 29 mm und 100 × 50 mm (Etikettenrolle, jedes Etikett eine Seite) oder ein **A4-Bogen mit 3 × 8 Etiketten** (70 × 37 mm). Bei einem angefangenen Bogen lassen Sie unter **Felder überspringen** die schon benutzten Felder aus. **Anzahl** druckt dasselbe Etikett mehrfach – zum Beispiel eins für den Reifensatz und eins für das Regal.
* **PDF oder Druckdialog:** Das **PDF** (Öffnen, Teilen, Herunterladen) ist meist der verlässlichere Weg zum Etikettendrucker. Alternativ druckt **Drucken** die Seite über den Druckdialog des Browsers; dort das Papierformat passend zum Etikett wählen und die Ränder auf „keine“ stellen.
* **Adresse der Anwendung:** Der Link im QR-Code braucht die Adresse, unter der die Anwendung im Browser erreichbar ist. Ein Administrator trägt sie unter **Einstellungen → Sicherheit → Adresse der Anwendung** ein (zum Beispiel `https://werkstatt.example`). Ohne sie druckt die Anwendung das Etikett **ohne QR-Code** und weist darauf hin. Die Adresse wird nie aus der Anfrage übernommen, sondern nur dort festgelegt.
* **Auf dem iPhone:** Ist die Anwendung als App installiert, kann **Öffnen** eines PDFs ohne Rückweg enden – nutzen Sie dort **Teilen** (zum Beispiel an die App des Etikettendruckers) oder **Herunterladen**. Siehe „Auf dem Handy installieren“.
* **Rechte:** Wer Reifensätze sehen darf, darf auch das Etikett drucken. Sätze von Kunden, deren Daten nur eingeschränkt verarbeitet werden (Art. 18 DSGVO), lassen sich nicht drucken.
