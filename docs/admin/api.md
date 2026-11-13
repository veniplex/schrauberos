# API & Webhooks

Andere Systeme – eine Buchhaltung, ein Terminportal, ein eigenes Skript – können Daten der Anwendung über die **Programmierschnittstelle** lesen und schreiben und per **Webhook** erfahren, wenn sich etwas ändert. Beides richten ausschließlich Administratoren ein (Verwaltung → **API & Webhooks**, Recht „API-Tokens und Webhooks verwalten“, das in keiner Standardrolle steckt). Die Schnittstelle zeigt nie Benutzer, Rollen, Einstellungen, Backups, Updates, das Audit-Log oder sensible Mitarbeiterdaten. Kunden mit **eingeschränkter Verarbeitung** (Datenschutz, Art. 18) sowie ihre Fahrzeuge, Aufträge, Belege, Termine, Dateien und Checklisten gibt es für die Schnittstelle nicht (404) – auch wenn nur das Fahrzeug einem eingeschränkten Kunden gehört. **Eine bewusste Ausnahme:** Das **Rechnungsarchiv** (`/invoices`) zeigt aufbewahrungspflichtige Belege auch dieser Kunden; ob das so bleibt, ist mit der Steuerberatung zu klären.

## Dienstkonten und API-Token

Ein **Token** ist das Passwort eines anderen Systems. Es gehört einem Konto – entweder **Ihrem eigenen** oder einem **Dienstkonto**. Für Integrationen, die dauerhaft laufen sollen (Buchhaltung, Portal), ist ein Dienstkonto richtig: Ein Token an Ihrem eigenen Konto endet mit jedem Passwortwechsel, mit „Überall abmelden“, mit dem Notzugang und wenn Ihr Konto gesperrt wird – dann stünde die Integration still.

### Dienstkonto anlegen

Unter **Dienstkonten → Neues Dienstkonto** vergeben Sie einen Namen und wählen die **Rollen** des Kontos. Ein Dienstkonto hat **kein Passwort und keine Anmeldung**: Es kann sich nicht in der Oberfläche anmelden, hat keinen Notzugang und keinen zweiten Faktor und ändert nie Benutzer, Rollen oder Einstellungen. Zur Wahl stehen nur Rollen ohne Administrator-Flag und ohne Verwaltungsrechte, und nur solche, die Ihr eigenes Konto vollständig besitzt – ein Dienstkonto hat nie mehr Rechte als die Person, die es angelegt hat. Das Passwort Ihres Kontos wird dabei erneut abgefragt. In der Benutzerliste erscheint das Konto mit dem Hinweis **Dienstkonto** und lässt sich dort nicht ändern.

**Ein Dienstkonto funktioniert nur mit API-Schlüsseln (Tokens):** Es gibt kein Passwort, keine Anmeldung in der Oberfläche und keine Sitzung. **Jeder Schlüssel lässt sich einzeln widerrufen** (Liste der Tokens, Knopf „Token widerrufen“), ohne die anderen Schlüssel des Kontos zu berühren, und hat seine **eigene Laufzeit** (30 bis 365 Tage oder unbegrenzt).

Tokens eines Dienstkontos überleben Ihren Passwortwechsel. Sie enden, wenn das Token abläuft (ohne Ablauf: nie) oder widerrufen wird oder wenn das Dienstkonto **ausgeschaltet oder gelöscht** wird (dann enden alle seine Tokens sofort; Einschalten verlangt Ihr Passwort, die früheren Tokens bleiben beendet). Hat die Pflicht-Zwei-Faktor-Anmeldung für Administratoren eine Wirkung auf Tokens, dann nur auf die **Ihres eigenen Administrator-Kontos** (es wird abgelehnt, bis Sie den zweiten Faktor eingerichtet haben) – nicht auf Tokens von Dienstkonten.

## API-Token anlegen

Unter **Tokens → Neues Token** geben Sie an:

* **Besitzer:** Ihr eigenes Konto oder ein Dienstkonto (siehe oben). Ein Token hat höchstens die Rechte des Besitzers – bei einem Dienstkonto zusätzlich nur solche, die Sie selbst haben.
* **Name und Beschreibung:** Wofür das Token gedacht ist („Buchhaltung Import“). Der Name erscheint in der Liste und im Audit-Log.
* **Gültigkeit:** 30, 90, 180 oder 365 Tage; danach muss das Token neu angelegt werden. Ein Token an Ihrem **eigenen Konto** läuft immer ab. Für ein **Dienstkonto** gibt es zusätzlich **Unbegrenzt (bis zum Widerruf)**: Das Token läuft nie ab und gilt, bis Sie es widerrufen oder das Dienstkonto ausschalten bzw. löschen. Das ist bequem für Integrationen, aber ein vergessenes Token bleibt dauerhaft wirksam – wählen Sie Rechte und Adressbereiche dann besonders eng und prüfen Sie die Liste regelmäßig (die Liste zeigt „ohne Ablauf“).
* **Rechte:** Gewählt wird je Ressource, und **Lesen und Schreiben/Löschen sind getrennte Rechte** – es ist nichts vorgewählt. „Alle lesenden Rechte“ wählt in einem Zug alles, was nur liest. Angeboten wird nur, was die Schnittstelle nutzt und was Ihr eigenes Konto selbst darf: Ein Token kann nie mehr als sein Besitzer (und der Server lehnt Rechte ohne Endpunkt ab).
* **Rechte mit Kennzeichnung** (zum Beispiel Versand oder Festschreiben) sind markiert. Sie lösen Unumkehrbares oder Ausgehendes aus – eine festgeschriebene Rechnung lässt sich nicht mehr ändern, ein versendeter Beleg nicht zurückholen. Sie lassen sich nur mit ausdrücklicher Bestätigung wählen.
* **Anfragen je Minute:** Darüber antwortet die Schnittstelle mit „429“.
* **Erlaubte Adressbereiche:** Optional ein Bereich je Zeile (zum Beispiel `203.0.113.0/24`). Das Token funktioniert dann nur von dort. Das setzt voraus, dass die Anwendung hinter einem Reverse-Proxy läuft und das unter **Einstellungen → Sicherheit** („Hinter Reverse-Proxy“) eingestellt ist – sonst kennt sie die Adresse des Aufrufers nicht, und ein beschränktes Token wird abgelehnt. Die Beschränkung schützt nur, wenn die Anwendung ausschließlich über den Proxy erreichbar ist (der Anwendungsport darf von außen nicht offen sein).
* **Ihr Passwort:** Zur Sicherheit wird das Passwort Ihres Kontos erneut abgefragt.

Nach dem Anlegen steht das Token **genau einmal** auf dem Bildschirm. Kopieren Sie es sofort an die Stelle, an der das andere System es ablegt (ein Geheimnis-Speicher, nicht ein Chat oder eine Tabelle). Die Anwendung speichert nur einen Hash; verloren gegangene Tokens lassen sich nicht wieder anzeigen – legen Sie ein neues an und widerrufen das alte.

### Sicher aufbewahren

* Nur über **HTTPS** verwenden; das Token steht bei jeder Anfrage im Kopf.
* Je System ein eigenes Token mit möglichst wenigen Rechten und kurzer Laufzeit; „Unbegrenzt“ nur, wenn ein Wechsel des Schlüssels im anderen System wirklich nicht zumutbar ist.
* Bei Verdacht sofort **Widerrufen**: Das wirkt bei der nächsten Anfrage.

### Wann ein Token ungültig wird

Ein Token gilt **nur so lange, wie sein Besitzer gültig ist**: Läuft das Token ab, wird es widerrufen, wird das Konto des Besitzers gesperrt, ausgeschaltet oder gelöscht, hat es einen ausstehenden Passwortwechsel oder (bei Pflicht-Zwei-Faktor für Administratoren, nur für Administrator-Konten) noch keine Einrichtung, hört das Token auf zu funktionieren. **Gehört das Token einer Person**, widerrufen ein Passwortwechsel, der Notzugang und „Überall abmelden“ alle ihre Tokens; **Tokens eines Dienstkontos** bleiben davon unberührt. Verliert der Besitzer ein Recht, verliert das Token es sofort. Nach einer Wiederherstellung eines Backups sind **alle** Tokens widerrufen – die Sicherung kennt spätere Widerrufe nicht.

## Dokumentation der Schnittstelle

Der Reiter **Dokumentation** beschreibt alle Endpunkte der aktiven Funktionen mit Recht, Parametern, Feldern und einem Aufruf zum Kopieren (mit Platzhalter statt Token), außerdem die Konventionen (Seiten, Sortierung, Versionen mit ETag, Wiederholungen mit Idempotency-Key, Fehler) und die Versionierung: Neue Endpunkte und optionale Felder sind kompatibel und kommen ohne Ankündigung; Unverträgliches erscheint nur in einer neuen Version (`/v2`). Die maschinenlesbare Beschreibung (OpenAPI) liefert die Seite als JSON; Werkzeuge mit Token laden sie von `/api/v1/openapi.json` und sehen dort nur die Endpunkte, deren Recht das Token trägt.

**Dateien:** Fotos und Dokumente an Fahrzeugen und Aufträgen (`/files`) und der Beleg einer Rechnung im Rechnungsarchiv (`/invoices/{id}/file`) lassen sich per Multipart hochladen und herunterladen. Das **Handbuch** ist lesend verfügbar (`/manual-pages`, nur Seiten ohne Rollenbeschränkung); die IT-Dokumentation ist nie über die Schnittstelle erreichbar.

## Webhooks

Ein **Webhook** meldet ein Ereignis (zum Beispiel „Auftrag abgeschlossen“, „Beleg bezahlt“) per HTTPS an ein Ziel. Die Meldung enthält **nur** Ereignis-ID, Typ, Zeitpunkt und die ID der betroffenen Sache – keine Kundennamen, Beträge oder Texte. Das Zielsystem holt die Einzelheiten über die Schnittstelle mit **seinem eigenen** Token; dessen Rechte entscheiden, was es sieht. Sensible Bereiche (Mitarbeiter, Krankheit, Zeiterfassung, Verwaltung) melden nichts.

1. **Webhooks → Neuer Webhook:** Name, Adresse (nur `https`) und die gewünschten Ereignisse wählen; zur Bestätigung wird Ihr Passwort abgefragt (ebenso bei einer neuen Adresse, bei einer neuen Freigabe fürs eigene Netz und beim Erneuern des Geheimnisses). Der eigene Rechner (bei einem Betrieb im Container auch der Docker-Host und die Gateways der Container-Netze), Link-Local-Adressen (`169.254.x.x`) und Metadaten-Dienste von Cloud-Anbietern sind nie erlaubt; ein Ziel im eigenen Netz (zum Beispiel `192.168.…`, auch die LAN-Adresse des Servers selbst) nur mit dem Häkchen **„Ziel im eigenen Netz erlauben“** – erst dann geht auch `http`.
2. Beim Anlegen entsteht das **Geheimnis der Signatur** und steht einmal auf dem Bildschirm. Es gehört in die Einstellungen des Empfängers. Der Webhook startet ausgeschaltet.
3. Auf der Webhook-Seite **Test-Ereignis senden**: ein einzelnes Ereignis vom Typ `webhook.test`, ohne Wiederholung – das Ergebnis (Antwortcode oder Fehlergrund) steht sofort dabei.
4. **Einschalten** (Schalter in der Liste oder auf der Webhook-Seite). Ausgeschaltet werden neue Ereignisse bis zu 14 Tage zurückgestellt und beim Einschalten nachgeholt; danach verfallen sie. Je Ziel werden höchstens **500 zurückgestellte** und **5000 wartende** Ereignisse gehalten; was darüber hinaus anfällt, wird **gezählt und verworfen** – die Webhook-Seite zeigt „n Ereignisse verworfen“, und das Audit-Log nennt die Zahl beim Einschalten. Holen Sie dann die Daten des Zeitraums über die Schnittstelle ab.
5. **Löschen** entfernt das Ziel samt Geheimnis **und seinem Zustellprotokoll** (das Audit-Log hält das Löschen mit dem Host fest).

### Signatur prüfen

Jede Anfrage trägt `X-Webhook-Id` (Ereignis-ID), `X-Webhook-Timestamp` und `X-Webhook-Signature: v1=<hex>`. Die Signatur ist ein **HMAC-SHA256** über `Zeitstempel.Ereignis-ID.Body` mit dem Geheimnis als Schlüssel. Der Empfänger muss den Body **unverändert** (als Text) prüfen, Zeitstempel ablehnen, die mehr als 5 Minuten von seiner Uhr abweichen (Schutz vor Wiederholung), und sich die Ereignis-IDs merken, denn die Zustellung erfolgt **mindestens einmal** und **ohne garantierte Reihenfolge** (eine Wiederholung kann ein späteres Ereignis überholen, zum Beispiel zwei Statuswechsel eines Auftrags) – bei einem Ereignis deshalb immer den **aktuellen Stand** über die Schnittstelle abholen. Fertigen Prüfcode für Node.js, Python und PHP zeigt der Reiter **Dokumentation**.

### Wiederholungen, Protokoll, aufgegebene Zustellungen

Antwortet das Ziel nicht mit einem Erfolgscode (2xx), versucht die Anwendung es nach 1, 5, 15 und 30 Minuten, nach 1, 2, 3 und 4 Stunden und dann alle 6 Stunden erneut, höchstens zwölfmal (rund 29 Stunden). Danach steht die Zustellung als **aufgegeben** im **Zustellprotokoll** (dazu eine Warnung oben auf der Seite); mit **Erneut zustellen** versuchen Sie sie nach der Behebung noch einmal – mit derselben Ereignis-ID. Meldet das Ziel „410 Gone“, schaltet die Anwendung den Webhook aus. Ein Lauf bedient jedes Ziel nur mit wenigen Zustellungen und lässt ein Ziel nach einem Fehlversuch bis zum nächsten Lauf ruhen – ein langsames oder totes Ziel hält die anderen nicht auf. **Aufgegebene Zustellungen** erscheinen auch im **Systemstatus**. Ereignisse zu Kunden mit eingeschränkter Verarbeitung (Art. 18) werden nie gesendet; im Protokoll stehen sie als **Unterdrückt** (keine Störung, nicht erneut zustellbar). Das Protokoll zeigt Zeit, Ziel, Ereignis, Zustand, Versuche, Antwortcode oder Fehlergrund und Dauer – **ohne Nutzlast und ohne Antwort des Empfängers** – und wird nach 30 Tagen gelöscht. Weiterleitungen folgt die Anwendung nie; ein Versuch dauert höchstens 10 Sekunden.

### Geheimnis erneuern

Auf der Webhook-Seite **Neues Geheimnis erzeugen**: Das neue Geheimnis steht einmal auf dem Bildschirm, das bisherige signiert noch 24 Stunden zusätzlich mit (zwei Signaturen im Kopf) – so kann der Empfänger in Ruhe umstellen.

## Wiederherstellung und Sicherheit

* Die Geheimnisse der Webhooks gehören zu den **Geheimnissen** der Anwendung: Sie stecken nicht lesbar in Backups. Wird ein Backup ohne den passenden Geheimnisschlüssel eingespielt, **schaltet die Anwendung die betroffenen Webhooks aus**; danach ein neues Geheimnis erzeugen, beim Empfänger eintragen und wieder einschalten (siehe **Backups**).
* **Nach jeder Wiederherstellung** – auch mit Wiederherstellungsschlüssel – sind **alle Webhooks ausgeschaltet** und wartende Zustellungen zurückgestellt: Eine Testkopie darf nie an die Empfänger der Produktivinstanz senden. Der **Systemstatus** weist darauf hin; prüfen Sie Adressen und Ereignisse und schalten Sie die Ziele dann wieder ein.
* Es gibt höchstens 20 Webhooks. Anlegen, Ändern, Löschen, Test, erneute Zustellung und Erneuern des Geheimnisses stehen im **Audit-Log** (mit Name und Host, nie mit Geheimnis oder ganzer Adresse); Anlegen und Widerrufen von Tokens ebenfalls, und bei Anfragen über ein Token steht dessen Name und Anfang im Audit-Log.
* Die Antworten der Schnittstelle auf wiederholte Anfragen mit demselben Idempotency-Key werden 24 Stunden gespeichert (sie enthalten die Daten des Ergebnisses und gehören zum Backup).
