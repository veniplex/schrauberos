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
