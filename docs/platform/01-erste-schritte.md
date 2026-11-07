# Erste Schritte

## Anmelden

Melden Sie sich mit Ihrem Benutzernamen und Passwort an. Wurde Ihr Konto neu angelegt oder Ihr Passwort zurückgesetzt, verlangt die
Anwendung beim ersten Anmelden ein eigenes Passwort (mindestens 8, höchstens 128 Zeichen).

Nach drei Fehlversuchen muss man vor dem nächsten Versuch warten: erst 2 Sekunden, dann immer länger, höchstens 90 Sekunden. Die
Meldung nennt die Restzeit. Das gilt für jeden Namen gleich – die Anwendung verrät nicht, ob es ein Konto gibt.

Die Wartezeit hängt **am Konto**, nicht an Ihnen persönlich: Versucht jemand anderes ständig, sich mit Ihrem Namen anzumelden, müssen
auch Sie auf einem **neuen Gerät** warten – ein richtiges Passwort hebt die Wartezeit dort nicht auf, solange der Beschuss andauert
(Abwarten, höchstens 90 Sekunden, oder der Wiederherstellungs-Code hilft). **Bekannte Geräte** sind davon ausgenommen: Nach einer
erfolgreichen Anmeldung merkt sich die Anwendung den Browser in einem Cookie (180 Tage, nur für Ihr Konto, in der Datenbank nur als
Prüfsumme). Von dort aus melden Sie sich auch während eines Angriffs mit dem richtigen Passwort an; für falsche Eingaben gilt dort ein
eigenes Limit. Das Cookie ersetzt das Passwort nicht. Ändert eine Administratorin Ihr Passwort oder wird der Notzugang benutzt, gelten
Ihre bekannten Geräte nicht mehr. Wer sein Passwort vergessen hat, bittet einen Administrator, es unter **Verwaltung → Benutzer**
zurückzusetzen (dort lässt sich auch eine laufende Wartezeit sofort aufheben).

> **Erste Einrichtung:** Beim allerersten Aufruf einer neuen Installation erscheint statt der Anmeldung die Ersteinrichtung:
> Einrichtungs-Token, Werkstattname, Zeitzone und das Konto des ersten Administrators. Das Token steht im Protokoll des Containers
> (`docker compose logs app`); es verhindert, dass Fremde die Einrichtung übernehmen. Auf Wunsch startet die Anwendung mit
> Beispieldaten zum Ausprobieren. Zum Schluss zeigt die Einrichtung Ihren **Wiederherstellungs-Code** (siehe unten) auf einer eigenen
> Seite; weiter geht es erst, wenn Sie bestätigen, ihn gesichert zu haben.

## Die Oberfläche

* **Navigation links:** Oben die **Übersicht**, darunter die Bereiche **Werkstatt**, **Büro**, **IT & Netzwerk**, das **Handbuch** und die
  **Verwaltung** – jeder Bereich mit seinem Titel und seinen Einträgen eingerückt darunter – und ganz unten die **Hilfe**. Ein Klick auf
  den Titel eines Bereichs klappt ihn auf oder zu; die Anwendung merkt sich das für Ihren Browser. Der Bereich der aktuellen Seite
  bleibt immer offen. Sie sehen nur, was Ihre Rolle erlaubt – fehlt ein Eintrag, ist er für Sie nicht freigeschaltet.
* **Kopfleiste:** Das **Suchfeld** durchsucht alle Bereiche auf einmal (Kunden, Fahrzeuge, Termine, Reifen, Rechnungen, Mitarbeiter, Fuhrpark,
  Netzwerk, Handbuch und IT-Dokumentation) und zeigt nur Treffer, die Ihre Rolle sehen darf. Ab zwei Zeichen erscheinen die Treffer als Links;
  mit der Pfeil-nach-unten-Taste springen Sie in die Liste, **Enter** im Suchfeld öffnet den ersten Treffer, **Escape** schließt die Liste.
  Rechts daneben legt **Neu** schnell etwas an (Kunde, Termin, Fahrzeug, Rechnung …) – es bietet nur an, was Sie anlegen dürfen.
* **Tastatur:** Der erste Tabstopp auf jeder Seite ist **Zum Inhalt springen** (überspringt die Navigation).
* **Übersicht:** Heute anstehende Termine, einzulagernde oder zu prüfende Reifen, offene Rechnungen, Fälligkeiten und angeheftete
  Seiten aus Handbuch und IT-Dokumentation – je nachdem, was Sie sehen dürfen.
* **Unten in der Navigation:** Ihr Name und Ihre Rollen. Ein Klick öffnet das Benutzer-Menü: Sprache (Deutsch/Englisch),
  Darstellung (Hell, Dunkel oder wie das Gerät), **Mein Konto** und **Abmelden**. Beim Abmelden werden auch nicht gespeicherte
  Entwürfe von Formularen aus dem Browser gelöscht.
* **Handy und Tablet (unter 1024 Pixel Breite):** Die Navigation liegt hinter dem Menü-Knopf links oben und klappt als Seitenfach auf
  (Schließen-Knopf, Escape oder ein Tipp daneben schließt es; die Seite dahinter bleibt stehen). Suche (Lupe), **Neu** (+) und Ihr Konto
  (Abmelden) liegen in der Kopfzeile: Die Lupe öffnet ein Suchfeld über die ganze Breite.

## Die Hilfe

Die Hilfe ist nach Bereichen gegliedert: **Allgemein** und dann je Bereich (Werkstatt, Büro, IT & Netzwerk, Verwaltung) ein Kapitel
pro Funktion. Über das Suchfeld oben finden Sie Kapitel nach Stichwort. Sie sehen nur Kapitel zu Funktionen, die in Ihrer
Installation eingeschaltet sind und die Ihre Rolle nutzen darf.

## Ihr Konto

Im Benutzer-Menü (unten in der Navigation, am Handy in der Kopfzeile) finden Sie **Mein Konto**: Name und E-Mail-Adresse ändern, Passwort ändern, Sprache und Darstellung
wählen. Beim Ändern des Passworts werden Sie auf allen anderen Geräten abgemeldet.

## Zugang verloren: der Wiederherstellungs-Code

Jedes Administrator-Konto hat einen **Wiederherstellungs-Code** – Ihren Notzugang, falls alle Administrator-Passwörter verloren gehen
(es gibt keine Rücksetz-Datei am Server und kein Zurücksetzen per E-Mail).

* **Aufbewahren wie ein Passwort.** Der Code umgeht Passwort und Zwei-Faktor-Anmeldung; wer ihn besitzt, kann das Konto übernehmen.
  Am besten ausdrucken (Knopf **Drucken**) und an einem sicheren Ort verwahren, zum Beispiel im Tresor. Er wird nur einmal angezeigt.
* **Erzeugen und erneuern:** Unter **Mein Konto → Notzugang** erzeugen Administratoren einen neuen Code. Dazu wird das aktuelle Passwort
  abgefragt; der bisherige Code wird dabei ungültig. Pro Konto gilt immer genau ein Code. Solange Sie nicht bestätigt haben, den Code
  gesichert zu haben, erinnert ein Hinweis oben auf jeder Seite.
* **Verwenden:** Auf der Anmeldeseite **Zugang verloren? Wiederherstellungs-Code verwenden** wählen, den Code (8 Gruppen zu je 5 Zeichen,
  Groß-/Kleinschreibung und Bindestriche egal) und ein neues Passwort eingeben. Ein Tippfehler wird schon beim Eingeben erkannt (das
  Prüfzeichen jeder Gruppe). Danach sind **alle Anmeldungen des Kontos beendet**, Sie melden sich mit dem neuen Passwort an, und der benutzte
  Code ist ungültig – Sie bekommen sofort einen neuen, den Sie wieder sichern.
* **Bei jeder Verwendung** sehen das betroffene Konto und alle Administratoren einen Hinweis (bis sie ihn bestätigen), und das Audit-Log
  hält es fest. Hat jemand den Code ohne Ihr Wissen benutzt, ändern Sie das Passwort und erzeugen einen neuen Code.
* **Nach einer Backup-Wiederherstellung** kann ein gedruckter Code veraltet sein: Der Code gehört zu den Daten und gilt nur für den Stand
  der Datenbank, in dem er erzeugt wurde. Erzeugen Sie dann einen neuen.
