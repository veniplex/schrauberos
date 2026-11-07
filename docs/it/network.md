# Netzwerk

Dieser Bereich dokumentiert das Firmennetz und ist für die IT-Administration gedacht. **Zugangsdaten werden bewusst nicht gespeichert.**


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

## Erreichbarkeit

Die Anwendung **prüft die Erreichbarkeit der Geräte noch nicht**. Deshalb steht bei jedem Gerät der Status **„Status unbekannt“** – es gibt keine Online-/Offline-Anzeige und keinen Baustein „Netzwerk-Status“ auf der Übersicht (früher gab es Demo-Werte, die nichts bedeuteten; sie sind entfernt). Die Angaben zu Geräten, Adressen und Verkabelung sind davon unberührt und werden von Hand gepflegt. Das Häkchen „Erreichbarkeit überwachen“ merkt ein Gerät für die spätere Netzwerk-Überwachung vor; bis es sie gibt, hat es keine Wirkung.
