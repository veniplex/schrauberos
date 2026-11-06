# Werkstatt

## Termine

Der Werkstattkalender zeigt die Termine als **Woche**, **Tag** (mit einer Spalte je Arbeitsplatz) oder als **Liste**.

* **Neuer Termin:** Knopf „Neuer Termin“ oder ein Klick in den Kalender. Angegeben werden Fahrzeug (Kennzeichen, Kunde oder Modell
  eintippen), Terminart, Arbeitsplatz, Mitarbeiter, Datum, Uhrzeit und Dauer. Die Terminart schlägt Farbe und Standarddauer vor.
* **Doppelbelegung:** Ein Arbeitsplatz lässt sich nicht zur selben Zeit zweimal belegen; die Anwendung sagt, wer den Platz
  schon hat.
* **Status:** Geplant, Bestätigt, In Arbeit, Erledigt, Storniert oder Nicht erschienen. Stornierte Termine blockieren keinen Platz.
* **Reifenwechsel:** Termine der Art „Reifenwechsel“ lassen sich mit einem eingelagerten Reifensatz verknüpfen.

Arbeitsplätze, Terminarten und das Kalender-Raster pflegt ein Administrator unter **Verwaltung → Einstellungen → Termine**.

## Reifenlager

Das Reifenlager ist die digitale Reifenliste: welche Reifen eines Fahrzeugs wo eingelagert sind und in welchem Zustand.

* **Reifensatz einlagern:** Fahrzeug wählen, Saison (Sommer, Winter, Ganzjahr), Marke, Größe, Felgenart und Lagerort eintragen. Je
  Position (vorne links/rechts, hinten links/rechts, Ersatzrad) lassen sich **DOT-Nummer**, **Profiltiefe** und **Zustand** erfassen.
  Der DOT-Code besteht aus vier Ziffern von der Reifenflanke, z. B. `2321` = Woche 23 des Jahres 2021; daraus wird das Alter berechnet.
* **Ampel:** Je Reifen und Satz zeigt die Anwendung *In Ordnung*, *Bald erneuern* oder *Erneuern* – nach Profiltiefe, Alter und
  Zustand. Die Grenzwerte stellt ein Administrator unter **Einstellungen → Reifenlager** ein.
* **Wechsel fällig:** Auf der Übersicht erscheinen Sätze, die zur aktuellen Saison montiert werden sollten und noch keinen Termin
  haben. Von dort lässt sich direkt ein Termin planen.
* **Status eines Satzes:** Eingelagert, Ausgelagert (montiert) oder Entsorgt.

## Kunden

Kundenstammdaten: Name oder Firma, Kundennummer, Kontakt und Adresse. Auf der Kundenseite stehen die Fahrzeuge des Kunden mit
ihren Reifensätzen sowie die letzten Termine. Wird ein Kunde gelöscht, bleiben seine Fahrzeuge ohne Halter erhalten.

## Fahrzeuge

Fahrzeuge sind eigenständig und brauchen **keinen** Kunden (Kennzeichen, Hersteller, Modell, Fahrgestellnummer, Baujahr).

* Ein Kennzeichen kann nur einmal vergeben werden.
* **Halterwechsel:** Über „Halterwechsel“ (Datum, optional Notiz) wechselt der Halter. Die **Historie** bleibt sichtbar; Reifensätze
  und Termine bleiben am Fahrzeug.
