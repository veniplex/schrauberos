# Aufträge

Ein Auftrag (Arbeitskarte) begleitet ein Fahrzeug von der Annahme bis zur Abholung. Die Funktion ist standardmäßig ausgeschaltet; ein Administrator schaltet sie unter
**Verwaltung → Module & Funktionen** ein. Sie braucht die Funktion **Fahrzeuge**; Termine und Kunden werden verknüpft, wenn sie aktiv sind.

## Ablauf

**Angenommen → In Arbeit → Fertig (abholbereit) → Abgeholt.** Dazu gibt es **Storniert**. Der Stand steht oben auf der Auftragsseite, jeder Wechsel mit Zeit und Person im **Verlauf**.

* **Auftrag annehmen:** Unter **Aufträge → Neuer Auftrag** das Fahrzeug wählen, Kundenwunsch und **Kilometerstand bei Annahme** eintragen. Schneller geht es aus einem Termin:
  Im Termin (Kalender, Termin anklicken) erscheint **Auftrag aus Termin**; Fahrzeug und Anliegen werden übernommen. Zu einem Termin kann es einen (nicht stornierten) Auftrag geben; einen Termin verknüpfen kann nur, wer Termine sehen darf.
  Jeder Auftrag bekommt eine fortlaufende Nummer der Form `A-2026-0001` ohne Lücken.
* **Kunde:** Er ergibt sich aus dem Halter des Fahrzeugs. Ein Fahrzeug ohne Halter ergibt einen Auftrag ohne Kunden. Archivierte Fahrzeuge lassen sich nicht annehmen; bei Kunden mit
  eingeschränkter Verarbeitung (Datenschutz) ist kein neuer Auftrag möglich.
* **Kilometerstand:** Ist der Stand bei Annahme **höher** als der im Fahrzeug gespeicherte (oder dort noch leer), übernimmt ihn das Fahrzeug. Ist er niedriger, bleibt der Stand im Fahrzeug
  unverändert – die Anwendung weist darauf hin, es ist kein Fehler (der Tacho kann getauscht worden sein).
* **Status:** Auf der Auftragsseite unter **Weiter im Ablauf**: *Arbeit beginnen*, *Fertig melden*, zurück, *Stornieren* und *Wieder aufnehmen*. Ein Termin zum Auftrag folgt automatisch:
  Beginnt die Arbeit, steht er auf *In Arbeit*; wird der Auftrag abgeschlossen, auf *Erledigt*. Ein stornierter Auftrag sagt den Termin nicht ab. Ein stornierter Auftrag lässt sich **wieder aufnehmen** – nicht, solange der Termin
  inzwischen einen anderen (nicht stornierten) Auftrag hat. Aufträge werden nie gelöscht; deshalb lässt sich auch ein **Fahrzeug oder Kunde mit Aufträgen nicht löschen** (die Seite nennt die Aufträge
  und bietet das Archivieren an).
* **Abschließen (abgeholt):** Mit dem Recht **Aufträge abschließen**. Beim Abschließen buchen andere Funktionen, zum Beispiel **Teile & Lager** den Abgang der verbrauchten Teile –
  entweder gelingt alles, oder der Auftrag bleibt offen und nichts ist gebucht. Ein abgeschlossener Auftrag lässt sich nicht mehr ändern.
* **Wieder öffnen:** Nur mit dem eigenen Recht **Abgeschlossene Aufträge wieder öffnen** (in keiner mitgelieferten Rolle enthalten, ein Administrator vergibt es bewusst). Der Auftrag steht danach
  auf *Fertig*, die Abbuchungen werden zurückgebucht, der Vorgang steht im Audit-Log. Erst dann lässt er sich ändern. Maßgeblich für die Rückbuchung ist, was für den Auftrag tatsächlich gebucht ist – ist die Funktion Teile & Lager zwischen Abschluss und Wiederöffnen ausgeschaltet,
  bucht das Wiederöffnen nichts zurück; der nächste Abschluss bucht dann nur den Unterschied (nie doppelt), ein Storno gibt die Buchungen frei.

## Positionen, Befunde, Freigaben

* **Positionen:** Arbeit, Teil oder Sonstiges, mit Beschreibung, Menge, Einheit, Netto-Einzelpreis, Steuersatz und Rabatt; unten stehen Netto, Steuer je Satz und Brutto.
  Am Handy erscheint jede Position als Karte und die Summe klebt am unteren Rand. Preise und Summen sehen und erfassen nur Personen mit dem Recht **Preise und Summen der Aufträge**;
  **Mechaniker haben es standardmäßig nicht** und sehen die Positionen ohne Preise. Ist im Werkstattprofil der Kleinunternehmer (§ 19 UStG) eingestellt, werden keine Steuern ausgewiesen.
  Ist **Teile & Lager** aktiv, lassen sich Artikel einfügen (Bezeichnung, Preis und Steuersatz werden vorbelegt und bleiben änderbar).
* **Befunde:** Freitext, beliebig viele. Jeder Befund trägt Verfasser und Zeit.
* **Kundenfreigabe bei Mehrarbeit:** Wird mehr Arbeit nötig als vereinbart, holt die Werkstatt die Freigabe ein und protokolliert sie: **Mehrbetrag (brutto)**, **Begründung**, die **freigebende Person**
  und die Art – **Unterschrift am Gerät** (auf dem Tablet zeichnen; wer nicht zeichnen kann, tippt den Namen und bestätigt) oder **telefonisch**. Zeitpunkt und erfassende Person werden festgehalten.
  Der **getippte Name** muss dem Namen der freigebenden Person entsprechen (Groß- und Kleinschreibung und doppelte Leerzeichen spielen keine Rolle), sonst nimmt die Anwendung die Freigabe nicht an;
  der bestätigte Name steht im Protokoll. Nach dem Speichern ist die Unterschrift **leer** – jede Freigabe braucht ihre eigene Unterschrift; dieselbe Zeichnung lässt sich nie für eine zweite Freigabe verwenden.
  Einträge im Protokoll lassen sich **nicht ändern oder löschen**; sie stehen auch im Audit-Log (dort nur mit der Auftragsnummer, ohne den Namen der freigebenden Person).
* **Datenschutz:** Bei einem Kunden mit **eingeschränkter Verarbeitung** lässt sich kein neuer Auftrag annehmen; schon angenommene Aufträge bleiben auf der Auftragsseite bearbeitbar, damit sie abgeschlossen werden können.
  Die Schnittstelle (API) behandelt sie wie nicht vorhanden. Beim **Anonymisieren** eines Kunden entfallen Kundenwunsch, Befunde und die Namen der freigebenden Personen (auch der getippte Name);
  Positionen, Begründung der Mehrarbeit, Beträge und die gespeicherte Unterschrift als Bild bleiben als Beleg des Vorgangs. Die **Auskunft** nennt auch, dass eine Unterschrift als Bilddatei gespeichert ist.

## Auftragskarte drucken

**Auftragskarte** auf der Seite eines Auftrags erzeugt den **Werkstattlaufzettel**: Auftrag, Fahrzeug, Kunde (Name; die Telefonnummer nur, wenn Sie Kunden sehen dürfen), Kundenwunsch, die **Positionen ohne Preise** und Platz für Notizen. Der **QR-Code** öffnet den Auftrag: mit der Kamera des Handys scannen, anmelden, fertig. **Preise stehen nie auf der Karte** – auch nicht für Personen mit dem Recht „Preise sehen“; die Karte bleibt in der Werkstatt.

* **Papier:** A4 oder A5. Die Karte gibt es als **PDF** (Öffnen, Teilen, Herunterladen) und als **Druckansicht** über den Druckdialog.
* **Annahmeprotokoll:** Sind die **Checklisten** eingeschaltet und Sie dürfen sie sehen, nennt die Karte den Stand des Annahmeprotokolls – nicht erstellt, begonnen oder abgeschlossen (mit Datum, Person und Art der Unterschrift). Das Protokoll selbst steht nicht auf der Karte; es bleibt bei den Checklisten.
* **QR-Code:** Er braucht die **Adresse der Anwendung** (Einstellungen → Sicherheit, durch einen Administrator). Ohne sie druckt die Anwendung die Karte ohne QR-Code und weist darauf hin.
* **Auf dem iPhone:** Bei der als App installierten Anwendung lieber **Teilen** oder **Herunterladen** statt **Öffnen** wählen (siehe „Auf dem Handy installieren“).
* Aufträge von Kunden, deren Daten nur eingeschränkt verarbeitet werden (Art. 18 DSGVO), lassen sich nicht drucken.

## Hinweise

* Die Liste zeigt standardmäßig die **offenen** Aufträge; die Suche findet Nummer, Kennzeichen, Fahrzeug, Halter und Kundenwunsch. Die Übersicht zeigt offene und abholbereite Aufträge.
* Mehrere Personen können denselben Auftrag öffnen: Hat jemand ihn inzwischen geändert, meldet die Anwendung einen Konflikt, statt etwas zu überschreiben.
* Eine Rechnung zum Auftrag entsteht erst mit der Funktion für Angebote und Rechnungen. Das Annahmeprotokoll (Zustand des Fahrzeugs bei Annahme) gehört zu den Checklisten.
