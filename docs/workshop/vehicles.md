# Fahrzeuge

Fahrzeuge sind eigenständig und brauchen **keinen** Kunden. Erfasst werden Kennzeichen, Hersteller, Modell, Fahrgestellnummer, Baujahr und – für den Alltag der Werkstatt –
**Prüffristen**, Kilometerstand, Kraftstoff, Erstzulassung und die Schlüsselnummern (HSN/TSN) aus der Zulassungsbescheinigung.

## Kennzeichen vergeben? Das ist eine Warnung, keine Sperre

* Gibt es ein Kennzeichen schon, **speichert die Anwendung nicht stillschweigend** – sie warnt: Das Formular zeigt das vorhandene Fahrzeug mit seinem Halter und bietet
  **„Vorhandenes Fahrzeug öffnen“** (in einem neuen Tab, das ausgefüllte Formular bleibt offen) und **„Trotzdem anlegen“** (bzw. „Trotzdem speichern“) an.
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
* **Halterwechsel:** Über „Halterwechsel“ (Datum, optional Notiz) wechselt der Halter. Die **Historie** bleibt sichtbar; Reifensätze
  und Termine bleiben am Fahrzeug.
