# Termine

Der Werkstattkalender zeigt die Termine als **Woche**, **Tag** (mit einer Spalte je Arbeitsplatz) oder als **Liste**.

* **Am Handy** (schmale Anzeige) zeigen Woche und Tag keinen Zeitraster, sondern oben einen **Wochenstreifen** mit den sieben Tagen (die Zahl nennt die Termine des Tages, ein Tipp wählt den Tag) und darunter die Termine des gewählten Tages als **Karten**: Zeit, Kennzeichen, Titel, Kunde, Arbeitsplatz, Mitarbeiter, Status und die **Notizen**. Der Wochenstreifen bleibt beim Scrollen unter der Kopfzeile stehen. Ab Tablet-Breite gibt es das Raster; der Tageskopf (Wochentage bzw. Arbeitsplätze) bleibt beim Scrollen stehen.
* **Termin ansehen:** Ein Tipp auf einen Termin öffnet ihn. Wer **kein** Recht zum Bearbeiten hat, sieht eine **Leseansicht** mit allen Angaben (der Kunde nur mit Namen; Kontaktdaten stehen nur in den Kundendaten) und den vollständigen Notizen.
* **Tastatur:** Im Raster erreicht Tab ein Zeitfenster, die **Pfeiltasten** bewegen sich im Raster (auf/ab = Uhrzeit, links/rechts = Tag bzw. Arbeitsplatz), Bild auf/ab springen vier Fenster, Pos1/Ende an den Rand; **Eingabe** öffnet „Neuer Termin“ zu dieser Zeit. Mit Tab geht es weiter zu den Terminen, jeder ist ein Link.

* **Neuer Termin:** Knopf „Neuer Termin“ oder ein Klick in den Kalender. Angegeben werden Fahrzeug (Kennzeichen, Kunde oder Modell
  eintippen), Kunde (auch ohne Fahrzeug), Terminart, Arbeitsplatz, Mitarbeiter (zuständig – ist die Funktion „Mitarbeiter“ eingeschaltet, stehen nur Mitarbeiter mit Benutzerkonto zur Auswahl), Datum, Uhrzeit und Dauer. Findet die Fahrzeugsuche nichts, bietet sie „Fahrzeug neu anlegen“ an (mit dem Recht zum Anlegen von Fahrzeugen). Die Terminart schlägt Farbe und Standarddauer vor.
* **Kunde:** Zum Termin gehört ein **Kunde**, auch **ohne Fahrzeug** (Laufkundschaft, Beratung, Abholung): Feld „Kunde“ im Formular. Wählen Sie ein Fahrzeug, das einen Halter hat, gilt **dessen Halter** (das Feld zeigt ihn nur an); ein Fahrzeug ohne Halter lässt den gewählten Kunden gelten. **Archivierte** Kunden und Fahrzeuge lassen sich für neue Termine nicht mehr wählen (bestehende Termine behalten sie).
* **Halterwechsel:** Wechselt der Halter eines Fahrzeugs (siehe Fahrzeuge), bekommen dessen **offene Termine, die noch nicht vorbei sind** (Geplant, Bestätigt, In Arbeit), ab dem Wechseltag den neuen Halter – erledigte, stornierte und vergangene Termine behalten den damaligen Kunden. Das Audit-Log nennt die Zahl der umgestellten Termine.
* **Hinweise im Formular:** Unter den Feldern erscheint – ruhig und **ohne eigene Bestätigung** – eine Liste „Zu beachten“: **Feiertag** (aus Einstellungen → Feiertage; ein halber Feiertag als solcher), **Ruhetag oder Zeit außerhalb der Öffnungszeiten**, ein **Termin über Mitternacht**, der **Zuständige ist abwesend** (die Art – etwa Krankheit – wird nie genannt, nur „abwesend“), der Zuständige hat **schon einen anderen Termin** in dieser Zeit und das **Fahrzeug hat am selben Tag schon einen Termin**. Das sind nur Hinweise, Speichern bleibt möglich. **Hart** bleibt allein die Doppelbelegung eines Arbeitsplatzes.
* **Termine über Mitternacht:** Ein Termin darf über Mitternacht gehen (Beginn plus Dauer, bis 12 Stunden). Im Raster erscheint er an **beiden Tagen** (bis 24:00 und ab 0:00), die Zeitangabe trägt „bis zum Folgetag“; ein Termin bis genau 0:00 Uhr gehört noch zum Starttag. Die Doppelbelegung des Arbeitsplatzes gilt über Mitternacht hinweg, auch über die Zeitumstellung (gerechnet wird in echten Stunden in der Zeitzone der Werkstatt).
* **Doppelbelegung:** Ein Arbeitsplatz lässt sich nicht zur selben Zeit zweimal belegen; die Anwendung sagt, wer den Platz
  schon hat.
* **Status:** Geplant, Bestätigt, In Arbeit, Erledigt, Storniert oder Nicht erschienen. Stornierte Termine blockieren keinen Platz.
* **Schnellstatus:** Auf den **Karten** (Liste, Handy-Ansicht von Woche und Tag), im **Raster** (die Knöpfe erscheinen, wenn man mit der Maus über einen Termin fährt oder ihn per Tab erreicht), auf der **Übersicht** („Heute und morgen“) und auf der Seite eines Reifensatzes stehen am Termin die Knöpfe **Starten**
  (In Arbeit) und **Fertig** (Erledigt) – ohne den Termin zu öffnen. Geplant/Bestätigt bieten beide, In Arbeit nur „Fertig“; erledigte, stornierte und nicht
  erschienene Termine haben keinen Schnellschritt (Korrekturen über **Bearbeiten**). Dafür genügt das Recht „Termine bearbeiten“ (bei den mitgelieferten Rollen auch
  der Mechaniker); es ändert sich nur der Status. Hat jemand den Termin inzwischen geändert, meldet die Anwendung einen Konflikt, statt zu überschreiben.
  Die Zeilen der Übersicht führen zum Termin im Kalender.
* **Reifenwechsel:** Termine der Art „Reifenwechsel“ lassen sich mit einem eingelagerten Reifensatz verknüpfen. Der Satz muss zum gewählten Fahrzeug gehören.
  Setzt man einen solchen Termin auf **Fertig**, schlägt die Anwendung vor, den Satz **ein- oder auszubuchen** (Frage mit Bestätigung, nur mit dem Recht
  „Reifensätze ein-/ausbuchen“) – siehe Reifenlager.

Arbeitsplätze, Terminarten und das Kalender-Raster pflegt, wer das Recht „Arbeitsplätze, Terminarten und Kalender einrichten“ hat
(Administratoren immer), unter **Verwaltung → Einstellungen → Termine** – oder über die Schaltfläche „Arbeitsplätze & Terminarten“
oben im Kalender.
