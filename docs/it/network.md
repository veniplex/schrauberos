# Netzwerk

Dieser Bereich dokumentiert das Firmennetz und ist für die IT-Administration gedacht. **Zugangsdaten gehören nicht hierher** (dafür gibt es, wo eingerichtet, den IT-Tresor).


## Geräte

Das Geräte-Inventar verzeichnet Server, Switches, Router, Firewalls, Access Points, Arbeitsplatz-PCs, Drucker u. v. m. mit Hersteller,
Modell, Seriennummer, Standort (Raum, Rack), Garantie und Notizen. Läuft die Garantie ab oder ist sie abgelaufen, wird das markiert.

## IP-Verwaltung

* **VLANs und Subnetze** (IPv4, von /16 bis /32) mit Auslastung. Ein **/31** (Punkt-zu-Punkt-Verbindung) hat zwei nutzbare Adressen, ein **/32** genau eine (einen einzelnen Host); bei allen anderen Netzen zählen Netz- und Broadcast-Adresse nicht als Host.
* **Überschneidungen:** Zwei Subnetze **im selben VLAN** (auch beide ohne VLAN) dürfen sich nicht überschneiden – weder dasselbe Netz noch ein Teil- oder Obernetz. In **verschiedenen VLANs** ist dasselbe Adressnetz möglich (zum Beispiel zwei getrennte Standorte mit 192.168.1.0/24); das Formular warnt dann mit Hinweis auf das andere Netz, und mit **Trotzdem speichern** wird es angelegt. Beim Ändern eines bestehenden Netzes (ohne Netz und VLAN zu ändern) erscheint die Warnung nicht erneut.
* **Adressen:** statisch, DHCP-Reservierung, reserviert oder Gateway – mit Gerät und MAC-Adresse. Eine Adresse ist **je Netz eindeutig**: Im selben Subnetz lässt sie sich nur einmal vergeben (egal, wie sie geschrieben ist, z. B. 192.168.001.010), in einem anderen Netz darf dieselbe Adresse vorkommen.
* **Freie Bereiche** und „nächste freie Adresse“ je Subnetz.
* Geprüft wird: gültige IPv4-Adresse, liegt im Subnetz, keine Dopplung im Netz, gültige MAC-Adresse.

## Verkabelung und Standorte

Die Kabelliste verbindet Gerät und Port mit Gerät und Port. Bei Geräten mit Port-Anzahl (Switch, Patchfeld) zeigt eine
Port-Übersicht, was angeschlossen ist; ein Port lässt sich nur einmal belegen. Standorte und Räume pflegt man unter
„Verkabelung & Standorte“.

## Überwachung (Erreichbarkeit)

Unter **IT & Netzwerk → Überwachung** prüft die Anwendung regelmäßig, ob Geräte und Dienste erreichbar sind. Die Überwachung ist **standardmäßig ausgeschaltet**: Solange sie aus ist – oder solange für ein Gerät noch nichts gemessen wurde – steht dort **„Status unbekannt“**. Die Anwendung zeigt nie einen Zustand, den sie nicht gemessen hat.

### Was geprüft wird

* **Kein Ping.** Geprüft wird per **TCP-Verbindung** (antwortet der Port?) oder per **HTTP/HTTPS-Anfrage** (antwortet der Webserver?). „Nicht erreichbar“ heißt deshalb: Auf diesem Port kam keine Antwort. Das kann ein ausgefallenes Gerät sein – oder eine Firewall, die genau diesen Port sperrt.
* **Ein Ziel** besteht aus Art der Prüfung, Host oder IP-Adresse, Port und bei HTTP/HTTPS einem Pfad. Man kann es einem Gerät zuordnen und die Adresse aus der IP-Verwaltung übernehmen. Ein Gerät mit mehreren Zielen ist „Online“, wenn alle antworten, „Eingeschränkt“, wenn nur einige antworten oder eines eine Warnung meldet, und „Offline“, wenn keines antwortet.
* **Intervall** zur Auswahl von 1 Minute bis 1 Stunde (Standard 5 Minuten). Höchstens 100 Ziele; jede Prüfung bricht nach 5 Sekunden ab. Ändern Sie das Intervall, richtet sich der nächste Termin nach der letzten Messung und dem neuen Intervall.
* **Entprellung:** Ein einzelner Fehlschlag ändert den Status noch nicht. Erst die zweite Messung in Folge (eine Minute später) meldet „Nicht erreichbar“, und das wird im Verlauf als Ausfall festgehalten – ebenso die Wiederkehr mit der Dauer des Ausfalls.
* **Veraltete Messung:** Ist die letzte Messung älter als drei Intervalle, ist der Status „unbekannt“ (nie grün aus alten Werten). Auch **ausgeschaltet** heißt unbekannt: Schalten Sie ein Ziel oder die ganze Überwachung aus, wird der Zustand zurückgesetzt – nach dem Wiedereinschalten wird neu gemessen, und eine Zeit ohne Überwachung zählt nie als Ausfall.
* **Eine Änderung der Adresse** (Host, Port, Pfad, Art) beginnt die Messung neu; ein Ergebnis, das noch zur alten Adresse gehört, wird verworfen.
* **HTTP/HTTPS:** Es wird nur die Statuszeile ausgewertet, nie der Inhalt der Antwort. Antworten 2xx, 3xx und 4xx gelten als erreichbar, 5xx als Warnung. Weiterleitungen werden **nicht** verfolgt. Die Anfrage ist `HEAD` (nur Kopfzeilen); `GET` sollte nur gewählt werden, wenn ein Gerät HEAD nicht versteht – ein GET kann bei einfachen Geräten eine Aktion auslösen. Kopfzeilen oder Zugangsdaten lassen sich nicht mitgeben.
* **Zertifikate:** Bei HTTPS ist ein abgelaufenes, unbekanntes oder nicht passendes Zertifikat **kein Ausfall**, sondern eine **Warnung**. Für Geräte mit selbst signiertem Zertifikat lässt sich das je Ziel mit „Zertifikatsfehler nicht melden“ abstellen.

### Wer darf was

* **Ansehen** (Status, Verlauf, Dashboard-Baustein) mit dem Recht „Netzwerk ansehen“. Die Adresse eines Ziels (Host, Port, Pfad) sieht nur, wer Ziele verwalten darf – sie steht aber auch im Audit-Log, das Administratoren und alle mit dem Recht „Audit-Log einsehen“ lesen.
* **Ziele anlegen, ändern, löschen und die Überwachung ein- oder ausschalten** nur mit dem eigenen Recht **„Netzwerk-Überwachung einrichten“**. Es steckt in keiner Standardrolle und lässt sich nicht an einen API-Token vergeben: Ein Überwachungsziel lässt den Server Verbindungen ins eigene Netz aufbauen. Gesperrt sind der eigene Rechner – bei einem Betrieb im Container auch der Docker-Host (das Standard-Gateway des Containers und `host.docker.internal`) –, Link-Local-Adressen (169.254.x.x, auch Metadaten-Dienste), Multicast und reservierte Adressen – auch für Administratoren. Private Adressen des Firmennetzes sind erlaubt.
* **Was das Recht bedeutet:** Wer es hat, kann den Server **interne Adressen und Ports abfragen** lassen. Zurück kommen nur Erreichbarkeit, Ergebnisklasse (zum Beispiel „Verbindung abgelehnt“, „HTTP 4xx“) und Antwortzeit – aber daran lässt sich erkennen, welche Dienste im Netz laufen. Bei HTTP(S) wird der gewählte Pfad samt Anfrage-Parametern abgefragt (meist `HEAD`); ein `GET` kann bei einfachen Geräten eine Aktion auslösen. Vergeben Sie das Recht deshalb sparsam. Zur Bremse sind **neue oder geänderte Zieladressen** je Konto begrenzt (nach zehn in kurzer Zeit muss das Konto warten); Umbenennen, Intervall und Ein-/Ausschalten zählen nicht. Das Recht setzt „Netzwerk ansehen“ voraus.

### Verlauf und Datenschutz

Gespeichert werden nur: erreichbar oder nicht, die Antwortzeit in Millisekunden, die Ergebnisklasse (zum Beispiel „HTTP 2xx“, „Zeitüberschreitung“, „Verbindung abgelehnt“) und der Zeitpunkt – **nie ein Antworttext**. Einzelmessungen bleiben 7 Tage, danach nur noch Stundenwerte (30 Tage); Ausfälle und Wiederkehr 90 Tage. Beim Löschen eines Ziels wird auch sein Verlauf gelöscht.

### Benachrichtigung

Ein nicht erreichbares Ziel erscheint im Baustein **„Netzwerk-Status“** auf der Übersicht, in der Überwachung und im Systemstatus. E-Mails oder Webhooks verschickt die Überwachung nicht.

Das Häkchen „Erreichbarkeit überwachen“ am Gerät merkt es nur vor; gemessen wird, sobald ein Ziel auf das Gerät verweist und die Überwachung eingeschaltet ist.
