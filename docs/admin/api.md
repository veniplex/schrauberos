# API & Webhooks

Andere Systeme – eine Buchhaltung, ein Terminportal, ein eigenes Skript – können Daten der Anwendung über die **Programmierschnittstelle** lesen und schreiben und per **Webhook** erfahren, wenn sich etwas ändert. Beides richten ausschließlich Administratoren ein (Verwaltung → **API & Webhooks**, Recht „API-Tokens und Webhooks verwalten“, das in keiner Standardrolle steckt). Die Schnittstelle zeigt nie Benutzer, Rollen, Einstellungen, Backups, Updates, das Audit-Log oder sensible Mitarbeiterdaten.

## API-Token anlegen

Ein **Token** ist das Passwort eines anderen Systems. Unter **Tokens → Neues Token** geben Sie an:

* **Name und Beschreibung:** Wofür das Token gedacht ist („Buchhaltung Import“). Der Name erscheint in der Liste und im Audit-Log.
* **Gültigkeit:** 30, 90, 180 oder 365 Tage. Ein Token läuft immer ab und muss danach neu angelegt werden.
* **Rechte:** Gewählt wird je Ressource, und **Lesen und Schreiben/Löschen sind getrennte Rechte** – es ist nichts vorgewählt. „Alle lesenden Rechte“ wählt in einem Zug alles, was nur liest. Angeboten wird nur, was die Schnittstelle nutzt und was Ihr eigenes Konto selbst darf: Ein Token kann nie mehr als sein Besitzer.
* **Rechte mit Kennzeichnung** (zum Beispiel Versand oder Festschreiben) sind markiert. Sie lösen Unumkehrbares oder Ausgehendes aus – eine festgeschriebene Rechnung lässt sich nicht mehr ändern, ein versendeter Beleg nicht zurückholen. Sie lassen sich nur mit ausdrücklicher Bestätigung wählen.
* **Anfragen je Minute:** Darüber antwortet die Schnittstelle mit „429“.
* **Erlaubte Adressbereiche:** Optional ein Bereich je Zeile (zum Beispiel `203.0.113.0/24`). Das Token funktioniert dann nur von dort. Das setzt voraus, dass die Anwendung hinter einem Reverse-Proxy läuft und das unter **Einstellungen → Sicherheit** („Hinter Reverse-Proxy“) eingestellt ist – sonst kennt sie die Adresse des Aufrufers nicht, und ein beschränktes Token wird abgelehnt.
* **Ihr Passwort:** Zur Sicherheit wird das Passwort Ihres Kontos erneut abgefragt.

Nach dem Anlegen steht das Token **genau einmal** auf dem Bildschirm. Kopieren Sie es sofort an die Stelle, an der das andere System es ablegt (ein Geheimnis-Speicher, nicht ein Chat oder eine Tabelle). Die Anwendung speichert nur einen Hash; verloren gegangene Tokens lassen sich nicht wieder anzeigen – legen Sie ein neues an und widerrufen das alte.

### Sicher aufbewahren

* Nur über **HTTPS** verwenden; das Token steht bei jeder Anfrage im Kopf.
* Je System ein eigenes Token mit möglichst wenigen Rechten und kurzer Laufzeit.
* Bei Verdacht sofort **Widerrufen**: Das wirkt bei der nächsten Anfrage.

### Wann ein Token ungültig wird

Ein Token gehört dem Konto, das es angelegt hat, und gilt **nur so lange, wie dieses Konto gültig ist**: Läuft das Token ab, wird es widerrufen, wird das Konto gesperrt oder gelöscht, hat es einen ausstehenden Passwortwechsel oder (bei Pflicht-Zwei-Faktor für Administratoren) noch keine Einrichtung, hört das Token auf zu funktionieren. **Ein Passwortwechsel, der Notzugang, „Überall abmelden“ und eine Wiederherstellung widerrufen alle Tokens des Kontos.** Verliert der Besitzer ein Recht, verliert das Token es sofort. Nach einer Wiederherstellung eines Backups sind alle Tokens widerrufen – die Sicherung kennt spätere Widerrufe nicht.

## Dokumentation der Schnittstelle

Der Reiter **Dokumentation** beschreibt alle Endpunkte der aktiven Funktionen mit Recht, Parametern, Feldern und einem Aufruf zum Kopieren (mit Platzhalter statt Token), außerdem die Konventionen (Seiten, Sortierung, Versionen mit ETag, Wiederholungen mit Idempotency-Key, Fehler) und die Versionierung: Neue Endpunkte und optionale Felder sind kompatibel und kommen ohne Ankündigung; Unverträgliches erscheint nur in einer neuen Version (`/v2`). Die maschinenlesbare Beschreibung (OpenAPI) liefert die Seite als JSON; Werkzeuge mit Token laden sie von `/api/v1/openapi.json`.

## Webhooks

Ein **Webhook** meldet ein Ereignis (zum Beispiel „Auftrag abgeschlossen“, „Beleg bezahlt“) per HTTPS an ein Ziel. Die Meldung enthält **nur** Ereignis-ID, Typ, Zeitpunkt und die ID der betroffenen Sache – keine Kundennamen, Beträge oder Texte. Das Zielsystem holt die Einzelheiten über die Schnittstelle mit **seinem eigenen** Token; dessen Rechte entscheiden, was es sieht. Sensible Bereiche (Mitarbeiter, Krankheit, Zeiterfassung, Verwaltung) melden nichts.

1. **Webhooks → Neuer Webhook:** Name, Adresse (nur `https`) und die gewünschten Ereignisse wählen. Der eigene Rechner, Adressen für Cloud-Dienste und Verbindungs-lokale Adressen sind nie erlaubt; ein Ziel im eigenen Netz (zum Beispiel `192.168.…`) nur mit dem Häkchen **„Ziel im eigenen Netz erlauben“** – erst dann geht auch `http`.
2. Beim Anlegen entsteht das **Geheimnis der Signatur** und steht einmal auf dem Bildschirm. Es gehört in die Einstellungen des Empfängers. Der Webhook startet ausgeschaltet.
3. Auf der Webhook-Seite **Test-Ereignis senden**: ein einzelnes Ereignis vom Typ `webhook.test`, ohne Wiederholung – das Ergebnis (Antwortcode oder Fehlergrund) steht sofort dabei.
4. **Einschalten** (Schalter in der Liste oder auf der Webhook-Seite). Ausgeschaltet werden neue Ereignisse bis zu 14 Tage zurückgestellt und beim Einschalten nachgeholt; danach verfallen sie.

### Signatur prüfen

Jede Anfrage trägt `X-Webhook-Id` (Ereignis-ID), `X-Webhook-Timestamp` und `X-Webhook-Signature: v1=<hex>`. Die Signatur ist ein **HMAC-SHA256** über `Zeitstempel.Ereignis-ID.Body` mit dem Geheimnis als Schlüssel. Der Empfänger muss den Body **unverändert** (als Text) prüfen, Zeitstempel ablehnen, die mehr als 5 Minuten von seiner Uhr abweichen (Schutz vor Wiederholung), und sich die Ereignis-IDs merken, denn die Zustellung erfolgt **mindestens einmal**. Fertigen Prüfcode für Node.js, Python und PHP zeigt der Reiter **Dokumentation**.

### Wiederholungen, Protokoll, aufgegebene Zustellungen

Antwortet das Ziel nicht mit einem Erfolgscode (2xx), versucht die Anwendung es nach 1, 5, 15 und 30 Minuten, nach 1, 2, 3 und 4 Stunden und dann alle 6 Stunden erneut, höchstens zwölfmal (rund 29 Stunden). Danach steht die Zustellung als **aufgegeben** im **Zustellprotokoll** (dazu eine Warnung oben auf der Seite); mit **Erneut zustellen** versuchen Sie sie nach der Behebung noch einmal – mit derselben Ereignis-ID. Meldet das Ziel „410 Gone“, schaltet die Anwendung den Webhook aus. Das Protokoll zeigt Zeit, Ziel, Ereignis, Zustand, Versuche, Antwortcode oder Fehlergrund und Dauer – **ohne Nutzlast und ohne Antwort des Empfängers** – und wird nach 30 Tagen gelöscht. Weiterleitungen folgt die Anwendung nie; ein Versuch dauert höchstens 10 Sekunden.

### Geheimnis erneuern

Auf der Webhook-Seite **Neues Geheimnis erzeugen**: Das neue Geheimnis steht einmal auf dem Bildschirm, das bisherige signiert noch 24 Stunden zusätzlich mit (zwei Signaturen im Kopf) – so kann der Empfänger in Ruhe umstellen.

## Wiederherstellung und Sicherheit

* Die Geheimnisse der Webhooks gehören zu den **Geheimnissen** der Anwendung: Sie stecken nicht lesbar in Backups. Wird ein Backup ohne den passenden Geheimnisschlüssel eingespielt, **schaltet die Anwendung die betroffenen Webhooks aus**; danach ein neues Geheimnis erzeugen, beim Empfänger eintragen und wieder einschalten (siehe **Backups**).
* Es gibt höchstens 20 Webhooks. Anlegen, Ändern, Löschen, Test, erneute Zustellung und Erneuern des Geheimnisses stehen im **Audit-Log** (mit Name und Host, nie mit Geheimnis oder ganzer Adresse); Anlegen und Widerrufen von Tokens ebenfalls, und bei Anfragen über ein Token steht dessen Name und Anfang im Audit-Log.
* Die Antworten der Schnittstelle auf wiederholte Anfragen mit demselben Idempotency-Key werden 24 Stunden gespeichert (sie enthalten die Daten des Ergebnisses und gehören zum Backup).
