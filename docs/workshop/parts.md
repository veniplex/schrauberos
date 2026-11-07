# Teile & Lager

Teile & Lager verwaltet Artikel (Handelsware, Verbrauchsmaterial) mit Bestand, Wareneingang, Inventur und allen Lagerbewegungen. Die Funktion ist standardmäßig ausgeschaltet; ein Administrator
schaltet sie unter **Verwaltung → Module & Funktionen** ein. **Kundenreifen** liegen im Reifenlager und sind keine Handelsware – sie gehören nicht hierher.

## Artikel

* **Artikel anlegen:** Artikelnummer (eindeutig, Groß- und Kleinschreibung zählt nicht), Bezeichnung, Einheit, Lieferant, Mindestbestand und Steuersatz. Den **Bestand** gibt man nicht von Hand ein:
  Er entsteht durch **Wareneingang** und **Inventur** und ändert sich beim Abschluss von Aufträgen.
* **Preise:** Einkaufs- und Verkaufspreis (netto) sehen und ändern nur Personen mit dem Recht **Einkaufs- und Verkaufspreise der Artikel**. **Mechaniker haben es standardmäßig nicht**:
  Für sie werden die Preise gar nicht erst gelesen. Der Verkaufspreis wird beim Einfügen eines Artikels in einen Auftrag vorbelegt und bleibt dort änderbar.
* **Mindestbestand:** Liegt der Bestand darauf oder darunter, erscheint der Artikel in der Liste (Filter **Unter Mindestbestand**) und auf der Übersicht. 0 bedeutet: kein Mindestbestand.
* **Archivieren:** Ein archivierter Artikel verschwindet aus der Auswahl und aus der Standardliste; Positionen, Bewegungen und Bestand bleiben. Gelöscht werden Artikel nie.

## Bestand und Bewegungen

Jede Änderung des Bestands ist eine **Bewegung**, die sich nicht mehr ändern oder löschen lässt. Die Seite eines Artikels zeigt sie mit Zeit, Person, Menge und dem Bestand danach.

* **Wareneingang** (Recht **Wareneingang und Inventur buchen**): Artikel, Menge, dazu die Nummer des Lieferscheins oder der Eingangsrechnung. Die Nummer tragen Sie von Hand ein;
  ist die Rechnungsfunktion aktiv, führt sie in der Bewegungsliste zu den Rechnungen.
* **Inventur:** Unter **Inventur** steht je Artikel der Sollbestand; Sie tragen den gezählten Bestand ein. Nur ausgefüllte Zeilen werden gebucht, die **Differenz** als Korrektur.
  Maßgeblich ist der Stand im Moment des Buchens. Jede Inventur steht im Audit-Log. Am Handy steht jeder Artikel für sich (Name, darunter Nummer und Soll, darunter die Eingabe), am Tablet und
  Computer in Spalten. Die Liste zeigt **höchstens 500 Artikel** je Seite (nach Artikelnummer); gibt es mehr, sagt die Seite es und führt über **Weiter mit den nächsten Artikeln** zu den übrigen –
  jede Seite wird für sich gebucht.
* **Beim Abschluss eines Auftrags** wird für jede Position mit Artikelverweis (Art *Teil*) die Menge abgebucht – **in derselben Transaktion** wie der Abschluss: Schlägt etwas fehl, bleibt der Auftrag
  offen und nichts ist gebucht. Positionen ohne Artikelverweis (freier Text) werden nicht gebucht. Eine Position mit **negativer Menge** (Gutschrift) bucht einen Zugang. Derselbe Artikel in mehreren
  Positionen zählt zusammen.
* **Wieder öffnen** eines abgeschlossenen Auftrags bucht zurück, was für ihn noch gebucht ist (Rückbuchung, auch eine Gutschrift wird wieder abgezogen): Danach steht der Bestand wie vor dem Abschluss,
  auch bei mehrfachem Abschließen und Öffnen. Maßgeblich sind die Bewegungen des Auftrags: Bucht ein Abschluss bereits Gebuchtes, wird nur der Unterschied gebucht. Eine **Stornorechnung** bucht den Bestand **nicht** automatisch zurück: Wurden Teile
  tatsächlich zurückgenommen, buchen Sie das als Wareneingang oder Inventur-Korrektur.
* **Negativer Bestand** ist erlaubt (die Ware war da, die Buchung hinkt hinterher). Er wird nicht verhindert, aber sichtbar: in der Artikelliste (Filter **Negativer Bestand**), auf der Artikelseite, auf
  der Übersicht und im Auftrag. Reicht der Bestand für die Teile eines offenen Auftrags nicht, steht dort ein Hinweis (gerechnet je Artikel mit der Summe aller Positionen); abschließen lässt sich der Auftrag trotzdem.
  Eine Buchung ändert die **Stammdaten des Artikels nicht**: Wer gerade den Artikel bearbeitet, bekommt wegen einer Buchung keinen Konflikt.

## Im Auftrag

Ist die Funktion **Aufträge** aktiv, erscheint im Positionen-Editor **Artikel einfügen**: Auswahl über Nummer oder Bezeichnung, Bezeichnung, Einheit, Verkaufspreis und Steuersatz werden vorbelegt.
Der Abschnitt **Verbrauchte Teile** auf der Auftragsseite zeigt, was gebucht wird oder schon gebucht ist. Wird die Funktion Teile & Lager ausgeschaltet, buchen Aufträge nichts mehr ab und zurück;
bereits gebuchte Bewegungen bleiben. Wird sie zwischen Abschluss und Wiederöffnen eines Auftrags aus- und wieder eingeschaltet, bucht der nächste Abschluss nur den noch fehlenden Unterschied
(nie doppelt); wird ein solcher Auftrag stattdessen storniert, gibt das Stornieren die Buchungen frei.
