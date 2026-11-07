# Auf dem Handy installieren

SchrauberOS lässt sich wie eine App auf den Startbildschirm von Handy und Tablet legen. Die Anwendung öffnet sich dann in einem eigenen Fenster ohne Adressleiste, mit
eigenem Symbol und passender Farbe der Statusleiste. Es ist weiterhin dieselbe Anwendung im Browser – nichts wird heruntergeladen, was Ihre Daten enthielte.

## Voraussetzung: verschlüsselte Verbindung (https://)

Browser erlauben das Installieren nur, wenn die Adresse mit **https://** beginnt (oder die Anwendung auf demselben Gerät läuft). Bei einer Adresse mit **http://** im
Werkstattnetz fehlt der Menüpunkt „Zur Startseite hinzufügen“ bzw. „App installieren“ oder er legt nur eine Verknüpfung auf die Webseite an – ohne eigenes Fenster und
ohne die Hinweise unten. Die Anwendung selbst funktioniert über http:// genauso; nur das Installieren und die Offline-Seite brauchen https://.
Wer die Anwendung bereitstellt (Administration), richtet https:// über einen vorgeschalteten Webserver mit Zertifikat ein; unter **Verwaltung → Einstellungen →
Sicherheit** zeigt die Anwendung, ob sie die Verbindung als verschlüsselt erkennt.

## So installieren Sie

* **iPhone und iPad (Safari):** Anwendung in **Safari** öffnen (nicht in einer anderen App), unten auf **Teilen** tippen, dann **Zum Home-Bildschirm** und **Hinzufügen**.
* **Android (Chrome):** Menü (drei Punkte) öffnen, **App installieren** (manchmal **Zum Startbildschirm hinzufügen**) wählen und bestätigen.
* **Computer (Chrome, Edge):** Rechts in der Adressleiste erscheint ein Installieren-Symbol; alternativ im Browsermenü **App installieren**.

Danach starten Sie SchrauberOS über das Symbol auf dem Startbildschirm. Die Anmeldung gilt wie im Browser; **Abmelden** finden Sie wie gewohnt im Benutzermenü.

## Was Sie erwarten dürfen – und was nicht

* **Ohne Verbindung** zeigt die Anwendung die Seite **„Keine Verbindung“** mit dem Knopf **Erneut versuchen**. Es gibt **keinen Offline-Betrieb**: Kunden, Termine und
  Rechnungen werden immer vom Server geladen und gespeichert. Was Sie ohne Verbindung eingeben, wird nicht gespeichert.
* Beim Abmelden räumt die Anwendung ihre zwischengespeicherten Dateien auf. Darin steckt nichts Fachliches und nichts, was zu Ihrer Anmeldung gehört (nur diese Offline-Seite und
  Programmdateien der Anwendung).
* **Neue Version:** Nach einem Update erscheint unten der Hinweis **„Neue Version verfügbar“** mit **Neu laden**. Tippen Sie darauf, wenn Sie gerade nichts bearbeiten – die Seite
  lädt dann neu und läuft in der neuen Version. Solange Sie nicht tippen, arbeiten Sie unverändert weiter.
* **PDF-Dateien** (z. B. ein Rechnungsbeleg) öffnen und laden Sie wie sonst über **Öffnen** bzw. **Herunterladen**; eine Vorschau im Fenster gibt es nur am Computer. Auf dem iPhone
  und iPad führt „Öffnen“ aus der installierten App heraus zur PDF-Ansicht des Systems; **Fertig** bzw. der Zurück-Pfeil des Systems bringt Sie wieder zurück.
* Eine installierte App folgt der Einstellung **Hell/Dunkel** der Anwendung und des Geräts.

## Wenn etwas nicht klappt

* **Kein Installieren-Menüpunkt:** Die Adresse beginnt mit http:// (siehe oben), oder Sie sind in einem privaten Fenster. Fragen Sie die Administration nach der https://-Adresse.
* **Falsche Anzeige nach einem Update:** Schließen Sie die App ganz (aus der App-Übersicht wegwischen) und öffnen Sie sie neu, oder tippen Sie auf **Neu laden**, wenn der Hinweis erscheint.
* **App entfernen:** wie jede andere App – auf dem Startbildschirm lange auf das Symbol drücken und **Entfernen** wählen. Ihre Daten liegen auf dem Server und bleiben unberührt.
