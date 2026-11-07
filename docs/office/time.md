# Zeiterfassung

Die Zeiterfassung hält Arbeitszeiten fest: **Stempeln** (Kommen/Gehen, auf einen Auftrag starten und beenden), Zeiteinträge mit Dauer in Stunden und **Arbeitswerten**, **Hinweise** zu Pausen und
Ruhezeit, **Korrekturen mit Begründung** und eine **Wochenübersicht** mit Ist, Soll und Saldo. Die Funktion ist standardmäßig ausgeschaltet; ein Administrator schaltet sie unter
**Verwaltung → Module & Funktionen** ein. Sie braucht die Funktion **Mitarbeiter**; mit **Aufträgen** zusammen erscheint zusätzlich der Abschnitt **Zeiten** auf der Auftragsseite.

## Voraussetzung: Mitarbeiter und Konto

Gestempelt wird für den Mitarbeiter, der mit dem eigenen Benutzerkonto verknüpft ist. Die Verwaltung trägt das beim Mitarbeiter ein (**Benutzerkonto**). Ohne diese Verknüpfung zeigt die Seite
einen Hinweis statt des Stempel-Knopfes. Ein ausgeschiedener Mitarbeiter (inaktiv) kann nicht mehr stempeln, seine Zeiten bleiben erhalten – ein **Mitarbeiter mit Zeiteinträgen lässt sich nicht
löschen**, nur auf inaktiv setzen.

## Stempeln

* **Kommen / Gehen:** Auf der Seite **Zeiterfassung** (am Handy auch direkt auf der Übersicht, Baustein **Stempeln**) startet der große Knopf einen Eintrag, derselbe Knopf beendet ihn.
  Beim Beenden lässt sich eine **Pause** in Minuten eintragen.
* **Auf einen Auftrag stempeln:** Vor dem Start einen **offenen Auftrag** wählen (und eine Tätigkeit eintragen). Die Zeit zählt dann auf diesen Auftrag. Ohne Auftrag zählt sie allgemein
  (Werkstatt, Büro, Fahrt). Für Aufträge von Kunden mit eingeschränkter Verarbeitung (Datenschutz) und für abgeschlossene Aufträge lässt sich nicht stempeln.
* **Immer nur ein laufender Eintrag:** Läuft schon einer, meldet die Seite es. Das gilt auch, wenn zwei Geräte gleichzeitig starten – es entsteht nur ein Eintrag.
* **Doppeltippen ist harmlos:** Der Knopf sperrt sich nach dem Antippen kurz. Ging die Antwort wegen schlechter Verbindung verloren, tippen Sie noch einmal – die Anwendung erkennt die
  Wiederholung und bucht nicht doppelt.
* **Vergessen zu beenden:** Ein Eintrag, der länger als 24 Stunden läuft, lässt sich nicht mehr einfach beenden; er wird unter **Einträge** korrigiert (mit Begründung). Läuft ein Eintrag
  länger als 16 Stunden, weist die Seite darauf hin.

## Dauer und Arbeitswerte

Jeder Eintrag zeigt die Dauer in **Stunden:Minuten** (nach Abzug der Pause) und in **Arbeitswerten (AW)**. Wie lang ein AW ist, steht im Werkstattprofil (Verwaltung → Einstellungen →
Werkstatt; Standard 1 AW = 5 Minuten).

## Hinweise zu Pausen und Ruhezeit

Die Seiten **Heute** und **Einträge** zeigen eine ruhige Hinweisliste, wenn die Zeiten von üblichen Vorgaben abweichen. Das sind **Hinweise, keine Sperren** – es wird nichts verhindert und nichts
verlangt:

* mehr als **6 Stunden** Arbeit an einem Tag mit weniger als **30 Minuten** Pause (ab 9 Stunden: 45 Minuten),
* mehr als **10 Stunden** Arbeit an einem Tag,
* weniger als **11 Stunden Ruhezeit** zwischen dem Ende eines Arbeitstags und dem Beginn des nächsten,
* ein Eintrag, der länger als 16 Stunden läuft (vermutlich nicht beendet).

Als Pause zählen die erfassten Pausen und die Lücken zwischen zwei Einträgen desselben Tages. Ein Tag, an dem gerade noch gestempelt wird, meldet keine fehlende Pause.
**Hinweis, keine Rechtsberatung:** Die Werte orientieren sich am Arbeitszeitgesetz, ersetzen aber keine arbeitsrechtliche Prüfung; tarifliche und betriebliche Regeln können abweichen.

## Woche: Ist, Soll, Saldo

Die Wochenübersicht zeigt je Tag die gearbeitete Zeit (**Ist**), die **Sollzeit** und den **Saldo**. Das Soll ist die Sollzeit je Arbeitstag (Verwaltung → Einstellungen → Zeiterfassung, Standard
8 Stunden) an den **Arbeitstagen der Person** (Teilzeit, bei den Mitarbeitern eingetragen). An **Feiertagen** (Region unter Einstellungen → Feiertage; ein halber Feiertag zählt halb) und bei
**Abwesenheit** ist das Soll 0 – die Zeiterfassung erfährt nur, *dass* die Person abwesend ist, nie ob es Urlaub oder Krankheit war. Mit den Pfeilen blättern Sie durch die Wochen.

## Korrigieren, stornieren, nachtragen

Zeiten werden **nie überschrieben und nie gelöscht**:

* **Korrigieren:** Auf der Seite eines Eintrags (unter **Einträge**) ändern Sie Beginn, Ende, Pause, Auftrag und Tätigkeit. Eine **Begründung ist Pflicht**. Der Stand davor bleibt im
  **Korrekturverlauf** mit Zeit, Person und Begründung stehen; jede Korrektur steht außerdem im Audit-Log. Einen vergessenen, noch laufenden Eintrag beenden Sie ebenfalls so.
* **Stornieren:** Ein stornierter Eintrag zählt nicht mehr, bleibt aber mit Begründung sichtbar (Filter **Mit stornierten**).
* **Nachtragen:** **Zeit nachtragen** trägt eine vergessene Zeit ein, ebenfalls mit Begründung; der Eintrag ist als *nachgetragen* gekennzeichnet. Zeiten dürfen sich nicht überschneiden und
  nicht in der Zukunft liegen.
* **Gesperrt:** Eine Zeit, die schon als Position in einen Auftrag übernommen wurde, lässt sich nicht mehr ändern.

## Wer sieht was

Mit dem Recht **Eigene Zeiten ansehen** sehen Sie nur Ihre eigenen Zeiten. Die Zeiten **aller** Mitarbeiter (Reiter **Team**, Filter **Mitarbeiter**) sieht nur, wer das Recht **Zeiten aller
Mitarbeiter ansehen** hat; fremde Zeiten korrigiert nur, wer zusätzlich **Zeiten aller Mitarbeiter korrigieren** hat. Beide Rechte sind personenbezogen und werden **nie automatisch** an eine
Standardrolle vergeben – ein Administrator vergibt sie bewusst in der Rollenmaske.

## Zeiten im Auftrag

Auf der Auftragsseite zeigt der Abschnitt **Zeiten** die Summe der Zeiten auf diesem Auftrag (alle Mitarbeiter, nur Zahlen), darunter Ihre eigenen Einträge (mit dem Recht für alle Zeiten alle).

* **Zeiten als Positionen übernehmen** (nur mit den Rechten *Aufträge bearbeiten* und *Preise und Summen der Aufträge*, am offenen Auftrag): Jede beendete, noch nicht übernommene Zeit wird als
  **Arbeitsposition** in den Auftrag übernommen – wahlweise in Stunden zum **Stundensatz** oder in **Arbeitswerten** (Satz je AW aus dem Stundensatz des Werkstattprofils). Der Stundensatz muss im
  Werkstattprofil stehen.
* **Nur einmal:** Jede Zeit wird als übernommen markiert und nie ein zweites Mal übernommen, auch nicht bei gleichzeitigem Klicken. Laufende Einträge bleiben unberührt.
* Die Positionen nennen Tätigkeit und Tag, nie den Namen des Mitarbeiters.

## Handy und Tablet

Der Stempel-Knopf ist groß (mindestens 64 Punkte hoch), die Eingaben haben große Ziele. Bei schlechter Verbindung zeigt der Knopf „Nicht gebucht“; ein erneutes Antippen wiederholt dieselbe
Buchung sicher.
