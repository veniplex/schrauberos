# SchrauberOS 0.2.0

Entwurf der Release-Notiz (Stand Block 13d). Vor dem Veröffentlichen: Abschnitt „Noch offen“ entscheiden und streichen, Realgeräte-Ergebnis eintragen. Die App zeigt „Was ist neu“ aus diesem Text, deshalb in verständlichem Deutsch ohne Entwicklerbegriffe halten (die technischen Zeilen stehen unter „Für Betreiber“).

## Wichtig vor dem Update: Neuinstallation nötig

**0.2.0 ist eine Neuinstallation, kein Update von 0.1.0.** Die Datenbank wurde neu aufgesetzt (eine einzige Baseline-Migration); ein Volume mit der Datenbank von 0.1.0 wird mit der Meldung „Neuinstallation nötig“ abgewiesen, ohne etwas zu verändern. Daten werden nicht übernommen. Danach gilt: Updates im Betrieb laufen über die Weboberfläche und sind ab dieser Version kompatibel (die Migrationen sind eingefroren).

Beim ersten Start: Einrichtungs-Token aus dem Container-Log, Einrichtung im Browser (Werkstattname, Zeitzone, erster Administrator, Preset), danach den **Wiederherstellungs-Code** (Notzugang) ausdrucken und – unter Verwaltung → Backups → Schlüssel – den **Wiederherstellungsschlüssel** erzeugen und sicher verwahren.

## Neu

**Alle neuen Funktionen sind standardmäßig aus.** Ein Administrator schaltet sie in „Module & Funktionen“ ein oder wählt bei der Einrichtung ein Preset (`basic`, `orders`, `invoicing`, `daily`). Ausgeschaltete Funktionen haben weder Menü noch Rechte; Daten bleiben beim Ausschalten erhalten.

* **Werkstatt:** Aufträge (aus Terminen, mit Befunden, Positionen, Freigabe durch den Kunden, Schnellstatus), Teile & Lager (Wareneingang, Inventur, Bestandsbuchung beim Abschluss), Dokumente & Fotos (Kamera, Mehrfach-Upload, Metadaten werden entfernt), Checklisten (Annahmeprotokoll mit Unterschrift, eigene Vorlagen), Reifenwechsel-Kreis (Ein-/Ausbuchen, Etiketten mit QR-Code), Kalender für Handy und Tablet, Kalender-Abo (iCal), Terminzettel, Halterwechsel und Archiv statt Löschen.
* **Büro:** Angebote, Auftragsbestätigungen, Abschlags- und Schlussrechnungen, Festschreiben und Storno per Gegenbeleg, E-Rechnung (XRechnung) als getrennter Download, Versand per E-Mail; Berichte (Umsatz, offene Posten, Auslastung); Zeiterfassung (Stempeln, Nachtragen, Übernahme in Aufträge); Mitarbeiter mit Teilzeit und Urlaubsstand; Feiertage nach Region.
* **IT:** Netzwerk-Überwachung (Erreichbarkeit per TCP/HTTP, Verlauf), IT-Tresor (verschlüsselt, Anzeige mit Passwortabfrage).
* **Verwaltung:** E-Mail-Versand, API und Webhooks (Tokens, Dienstkonten, Doku-Seite), Systemstatus, Off-Site-Backup (SFTP/WebDAV, verschlüsselt), Wiederherstellungsschlüssel, Datenaustausch (CSV-Export/-Import), Rollenmaske mit Vorlagen.
* **Sicherheit und Konto:** Zwei-Faktor-Anmeldung (optional), Sitzungen und bekannte Geräte (nur auf Wunsch), Notzugang per Wiederherstellungs-Code, Datenschutz-Auskunft, Einschränken und Anonymisieren von Kunden.
* **App:** installierbar auf Handy und Tablet (HTTPS nötig), Offline-Seite, Nennform in der Oberfläche, größere Bedienelemente auf Touch.

## Geändertes Verhalten (bitte lesen)

* **Rechte:** Diese Rechte stehen in **keiner Standardrolle** und werden bewusst vergeben: `invoices.finalize` (Festschreiben), `billing.send` und `mail.send` (Versand), `orders.reopen`, `checklists.reopen`, `time.viewAll`, `time.correctAll`, `reports.export`, alle Export-/Import-Rechte, `customers.disclose`, `customers.privacy`, `network.monitor`. Die **Tresor-Rechte** gelten nur, wenn eine Rolle sie ausdrücklich enthält – **auch Administratoren haben sie nicht automatisch**. Kein API-Token kann diese Rechte tragen. `reports.view` haben Geschäftsführung und Büro.
* **Kundendaten:** Telefon des Halters und Ort des Kunden sehen nur Personen mit `customers.view`; Kennzeichen suchen in der Kundenliste nur mit `vehicles.view`. Eingeschränkte Kunden (Art. 18) erscheinen nirgends mehr in Auswahl, Suche, Export, API und Kalender-Abo.
* **Zeit:** Die **Werkstatt-Zone** (Einstellungen) bestimmt „heute“ und alle Uhrzeiten; die Zeitzone des Servers ist ohne Bedeutung. Kalendertage werden als Mittag der Werkstatt-Zone gespeichert; ein Zonenwechsel kann bei weit entfernten Zonen gespeicherte Tage um einen Tag verschieben.
* **Gerätestatus** im Netzwerk kommt nur aus Messungen („Status unbekannt“, solange nichts gemessen wurde); die frühere Demo-Anzeige ist entfernt. Die Überwachung ist standardmäßig aus.
* **Hinweise statt Sperren:** Kennzeichen-Dubletten, Feiertage, Öffnungszeiten, Abwesenheit und ein schon terminiertes Fahrzeug sind Hinweise ohne Sperre; hart bleibt nur die Doppelbelegung eines Arbeitsplatzes.
* **Fahrzeuge** lassen sich nur ohne Geschichte löschen (sonst archivieren). Ein **Halterwechsel** zieht offene Termine nach. **IP-Adressen** sind je Netz eindeutig (dieselbe Adresse in einem anderen Netz ist erlaubt).
* **Rechnungen:** Festgeschriebene Ausgangsrechnungen sind unveränderlich und nicht löschbar; Korrektur nur per Gegenbeleg. PDF und XRechnung werden bei jedem Abruf neu erzeugt (Logo, Layout und Texte sind aktuell); die beim Versand angehängte Kopie ist die versendete Fassung. Kein ZUGFeRD/PDF/A-3.
* **Abo-Adressen** des Kalenders erlöschen bei Passwortwechsel, Deaktivierung, Notzugang, „Überall abmelden“, Rechteverlust „Termine ansehen“ und nach jeder Wiederherstellung. **Etiketten** (QR-Codes) brauchen die Einstellung „Adresse der Anwendung“.
* **Sitzungen und Tokens:** Passwortwechsel, Notzugang, Deaktivierung und „Überall abmelden“ widerrufen alle API-Tokens des Kontos (Dienstkonten ausgenommen). Nach **jeder Wiederherstellung** sind Webhooks aus und Tokens widerrufen. Der Notzugang setzt einen eingerichteten zweiten Faktor zurück.
* **Backups:** Aufbewahrung je Art einstellbar (Standard: `pre-*`-Sicherungen bleiben 5), das neueste Backup überhaupt bleibt immer. Eine Wiederherstellung **ohne** Wiederherstellungsschlüssel setzt Update-Token, Off-Site-Zugang, Webhook-Geheimnisse, zweiten Faktor und Tresor zurück (mit Sicherung der Zeilen unter `secret-reset/`).
* **Oberfläche:** Anrede in der Nennform, dunklere Ränder von Eingabefeldern, die Übersicht zeigt die vier wichtigsten Bausteine (Rest zugeklappt), Kürzel der Abwesenheit (U Urlaub, K Krank, S Schulung, X Sonstiges, A abwesend), das Abwesenheitsraster erscheint unter 768 px nicht (Liste und Knopf bleiben). Das **JS-Budget** je Seite ist um etwa 105 KB gewachsen (565 → 670 KB).
* **Anmeldung:** „Dieses Gerät merken“ nur auf Wunsch (nie vom Passwort oder zweiten Faktor befreit); Leerlauf-Frist und Pflicht-2FA für Administratoren sind Standard aus.
* **Technisch:** SVG-Logos werden nicht mehr angenommen (Standardmarke), das Logo ist ohne Anmeldung abrufbar; Doku-Bild-Upload verlangt `Content-Length`; hinter einem Reverse-Proxy mit umgeschriebenem Host die Einstellung „Hinter Reverse-Proxy“ (`X-Forwarded-Host`); Off-Site-Dateien `.sobk` Version 2; Webhooks, Off-Site und E-Mail erreichen den **Docker-Host nicht mehr** (wie schon die Überwachung).

## Für Betreiber

* Image: `ghcr.io/veniplex/schrauberos:0.2.0` (auch `0.2`, `latest`). Gehärteter Betrieb: `docker-compose.hardened.yml`. HTTPS (Reverse-Proxy) ist für die installierbare App nötig.
* Das Paket enthält Anwendung, Laufzeit und Launcher; der Starter prüft installierte Versionen bei jedem Start gegen Siegel und Dateiliste. Releases sind mit einer Schlüsselkette (Wurzel- und Release-Schlüssel) signiert.
* Neue Abhängigkeiten: `pdfkit`, `fontkit`, `nodemailer`, `ssh2`, `qrcode-generator` (alle exakt gepinnt, ohne native Teile).

## Noch offen (Entscheidungsvorlage, vor dem Veröffentlichen streichen)

Die vollständige Liste mit Empfehlung steht im Übergabebericht von Block 13d; hier die Kurzform nach Thema.

* **Fachliche Freigabe durch den Steuerberater:** Rechnungserstellung (Pflichtangaben, Kleinunternehmer-Text, 0 %-Positionen, Anrechnung von Abschlägen, Storno ohne Fälligkeit), XRechnung (nie gegen den KoSIT-Prüfer gelaufen; der Pipeline-Job tut es), Aufbewahrungsfristen (Platzhalter; die Anonymisierung bleibt gesperrt, bis ein Administrator sie bestätigt), Umsatz-Definition der Berichte, Kassenhinweis.
* **Daten ohne Primärquelle:** Feiertage der Schweizer Kantone und österreichischen Landesfeiertage, Arbeitszeit-Schwellen, Drehmomentwerte der Checklisten-Vorlagen.
* **Rechte:** `employees.sensitive` steckt in der Standardrolle „Geschäftsführung“ (Empfehlung: entfernen und kennzeichnen), Notausschalter für die Pflicht-2FA, eigene Tresor-Hülle statt „ein Schlüssel für alles“.
* **Webhooks, Off-Site und E-Mail** erreichen den Docker-Host nicht (Entscheid des Entwicklungsteams, zu bestätigen).

## Realgeräte-Ergebnis

| Gerät | Version | Browser | Ergebnis |
| --- | --- | --- | --- |
| iPhone | | Safari | |
| Android | | Chrome | |
| iPad | | Safari | |
