# Checklisten

Checklisten führen durch wiederkehrende Arbeiten und halten sie fest: **Annahmeprotokoll** (mit Kundenunterschrift), **Ölwechsel**, **Reifenwechsel** (mit Anzugsdrehmoment, Profiltiefe und Reifendruck) und
**HU-Vorbereitung** – und eigene Vorlagen der Werkstatt. Die Funktion ist standardmäßig ausgeschaltet; ein Administrator schaltet sie unter **Verwaltung → Module & Funktionen** ein. Sie braucht die Funktion
**Fahrzeuge**; am Auftrag erscheint der Abschnitt **Checklisten**, wenn **Aufträge** aktiv sind.

## Eine Checkliste beginnen

* **Am Auftrag:** Auf der Auftragsseite zeigt die Karte **Checklisten** den Knopf **Annahmeprotokoll starten** (nur am offenen Auftrag) und **Weitere Checkliste beginnen**.
* **Am Fahrzeug:** Auf der Fahrzeugseite die Karte **Checklisten** – für eine Arbeit ohne Auftrag (z. B. HU-Vorbereitung).
* **Über das Menü:** **Checklisten → Checkliste beginnen**: Vorlage und Fahrzeug wählen.
* Die Punkte der Vorlage werden **kopiert**: Spätere Änderungen an der Vorlage ändern begonnene und abgeschlossene Checklisten nie.

## Ausfüllen

Jeder Punkt speichert **für sich**, sobald er abgehakt wird – ein „Speichern“ am Ende gibt es nicht. Die Zeilen sind groß genug für Handschuhe (mindestens 44 Punkte). Scheitert das Speichern (schlechte Verbindung),
bleibt der Punkt als **Nicht gespeichert** stehen und lässt sich mit **Erneut versuchen** wiederholen. Haken zwei Personen gleichzeitig denselben Punkt ab, gewinnt die erste Änderung; die andere sieht einen Konflikt
mit **Neu laden**. Wer abgehakt hat und wann, steht am Punkt.

| Art | Eingabe |
| --- | --- |
| **Haken** | abhaken |
| **Messwert** | Zahl mit Einheit; Mindest- und Höchstwert sind Grenzen: ein Wert außerhalb wird gespeichert und als **Außerhalb der Grenzen** gekennzeichnet (kein Sperren) |
| **Drehmoment** | Zahl in Nm, mit Sollwert und Grenzen wie ein Messwert |
| **Auswahl** | eine Möglichkeit aus der Liste |
| **Freitext** | Text |
| **Foto-Hinweis** | Erinnerung, ein Foto aufzunehmen (unter **Dokumente & Fotos** am Auftrag), dann abhaken |

**Pflichtpunkte** müssen vor dem Abschluss erledigt sein; nicht erforderliche Punkte dürfen offen bleiben.

## Abschließen und Unterschrift

Unten auf der Checkliste: **Checkliste abschließen**. Je nach Vorlage ist die **Kundenunterschrift** nicht vorgesehen, **möglich** oder **Pflicht**. Der Kunde unterschreibt mit dem Finger oder Stift auf dem Zeichenfeld
(das Feld scrollt dabei nicht mit) – oder, wenn er das nicht kann, über **Namen tippen** mit Bestätigung. Dann muss der getippte Name mit dem eingetragenen **Namen des Kunden** übereinstimmen. Eine gezeichnete
Unterschrift gilt für **genau eine** Checkliste; dasselbe Bild nochmals wird abgelehnt.

**Danach ist die Checkliste unveränderlich.** Nur wer das eigene Recht **Abgeschlossene Checklisten wieder öffnen** hat (gehört in keine Standardrolle, die Administration vergibt es bewusst) kann sie mit **Begründung** wieder öffnen; das steht im Verlauf und im Audit-Log, die
bisherige Unterschrift gilt dann nicht mehr (die Datei bleibt zur Nachvollziehbarkeit liegen). Eine Checkliste an einem **abgeschlossenen Auftrag** lässt sich nicht mehr ändern oder wieder öffnen (der Auftrag ändert
sich nur über „Wieder öffnen“).

Eine falsch begonnene, noch offene Checkliste lässt sich **verwerfen**; sie bleibt mit Verlauf erhalten, zählt aber nicht mehr als offen.

## Vorlagen verwalten (Leitung)

Unter **Checklisten → Vorlagen verwalten**: Vorlagen anlegen und bearbeiten – Name, Beschreibung, Kundenunterschrift (keine/möglich/Pflicht) und die Punkte mit Art, Pflicht, Einheit, Grenzen, Sollwert, Auswahl und Hinweis;
Punkte umsortieren, hinzufügen und entfernen.

* **Jede Änderung erzeugt eine neue Version.** Der Versionsverlauf zeigt Anmerkung, Person, Zeit und wie viele Checklisten die Version benutzen. Speichern ohne Änderung erzeugt keine neue Version.
* **Mitgelieferte Vorlagen:** Annahmeprotokoll, Ölwechsel, Reifenwechsel und HU-Vorbereitung lassen sich mit **Mitgelieferte Vorlagen einrichten** anlegen. Die Werte darin (Drehmoment der Radschrauben, Profiltiefe, Reifendruck)
  sind **übliche Richtwerte** und gelten nicht für jedes Fahrzeug: Passen Sie sie an Ihre Fahrzeuge an. Die Texte der Vorlagen sind deutsch (sie sind Daten der Werkstatt und lassen sich ändern).
* **Archivieren:** Eine archivierte Vorlage lässt sich nicht mehr beginnen; vorhandene Checklisten bleiben.

## Wer sieht was

Eine Checkliste **am Auftrag** sehen Sie mit dem Recht **Checklisten ansehen** und dem Recht, Aufträge anzusehen; eine Checkliste **am Fahrzeug** mit dem Recht, Fahrzeuge anzusehen. Bei Kunden mit **eingeschränkter
Verarbeitung** (Art. 18 DSGVO) sind Checklisten ihrer Fahrzeuge und Aufträge nicht sichtbar, und es lassen sich keine neuen beginnen. Beginnen und ausfüllen darf, wer **Checklisten beginnen und ausfüllen** darf.

## Datenschutz

Die **Auskunft** für einen Kunden nennt seine Checklisten (Vorlage, Datum, Name zur Unterschrift, Hinweis auf die gespeicherte Unterschrift, Freitexte). Bei der **Anonymisierung** werden Kundenname, getippter Name,
Anmerkung, die Freitexte und die Begründungen beim Wiederöffnen gelöscht; **die Unterschrift als Bilddatei bleibt** (sie belegt den Vorgang und lässt sich nicht in einem Schritt zurückholen). Haken, Messwerte und Vorlage bleiben.

## Druck

Das Annahmeprotokoll (Punkte, Messwerte, Unterschrift) steht dem Druck von Auftragskarte und Terminzettel zur Verfügung, sobald diese Funktionen aktiv sind.
