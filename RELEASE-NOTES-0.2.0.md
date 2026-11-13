# SchrauberOS 0.2.0

Entwurf der Release-Notiz (Stand Block 14). Vor dem Veröffentlichen: Abschnitt „Noch offen“ prüfen und streichen, Realgeräte-Ergebnis eintragen. Die App zeigt „Was ist neu“ aus diesem Text, deshalb in verständlichem Deutsch ohne Entwicklerbegriffe halten (die technischen Zeilen stehen unter „Für Betreiber“).

## Wichtig vor dem Update: Neuinstallation nötig

**0.2.0 ist eine Neuinstallation, kein Update von 0.1.0.** Die Datenbank wurde neu aufgesetzt (eine einzige Baseline-Migration); ein Volume mit der Datenbank von 0.1.0 wird mit der Meldung „Neuinstallation nötig“ abgewiesen, ohne etwas zu verändern. Daten werden nicht übernommen. Danach gilt: Updates im Betrieb laufen über die Weboberfläche und sind ab dieser Version kompatibel (die Migrationen sind eingefroren).

Beim ersten Start: Einrichtungs-Token aus dem Container-Log, Einrichtung im Browser (Werkstattname, Zeitzone, erster Administrator, Preset), danach den **Wiederherstellungs-Code** (Notzugang) ausdrucken und – unter Verwaltung → Backups → Schlüssel – den **Wiederherstellungsschlüssel** erzeugen und sicher verwahren.

## Rechnungserstellung: vor dem produktiven Einsatz vom Steuerberater freigeben lassen

**Die Rechnungserstellung (Angebote & Rechnungen) ist fachlich nicht freigegeben.** Bevor echte Rechnungen versendet werden, muss die Steuerberatung Pflichtangaben und Prüfliste, den Kleinunternehmer-Text (Kategorie „steuerfrei“), 0 %-Positionen, die Darstellung der Abschläge in der Schlussrechnung und beim Storno sowie den Kassenhinweis (Barzahlungen, § 146a AO) freigeben. Der **Wortlaut** der Schlussrechnung (Abschläge getrennt nach Entgelt und Umsatzsteuer, danach Restbetrag), des Stornos einer Schlussrechnung (Erstattungsbetrag) und der Anmerkungen in der XRechnung ist eine **Annahme des Entwicklungsteams**. Die Funktion ist standardmäßig ausgeschaltet. Die **Originalrechnung** (PDF und – wenn vollständig – XRechnung) wird beim Festschreiben und beim Storno als unveränderliche Datei abgelegt, mit Prüfsumme geprüft ausgeliefert und beim Versand angehängt; die Steuerberatung bewertet Form und Dauer der Aufbewahrung. Nur Inland (Land DE; Steuerkategorien „normal“ und „steuerfrei“, kein Reverse-Charge, keine innergemeinschaftliche Lieferung, keine Ausfuhr). Die **E-Rechnungspflicht im B2B** (Empfang seit 2025, Versand gestaffelt bis 2028) klärt die Steuerberatung.

## Neu

**Alle neuen Funktionen sind standardmäßig aus.** Ein Administrator schaltet sie in „Module & Funktionen“ ein oder wählt bei der Einrichtung ein Preset (`basic`, `orders`, `invoicing`, `daily`; **`daily` (Werkstattalltag) schaltet auch die Rechnungserstellung ein** – die Einrichtung warnt, dass sie vor dem produktiven Einsatz vom Steuerberater freizugeben ist). Ausgeschaltete Funktionen haben weder Menü noch Rechte; Daten bleiben beim Ausschalten erhalten.

* **Werkstatt:** Aufträge (aus Terminen, mit Befunden, Positionen, Freigabe durch den Kunden, Schnellstatus), Teile & Lager (Wareneingang, Inventur, Bestandsbuchung beim Abschluss), Dokumente & Fotos (Kamera, Mehrfach-Upload, Metadaten werden entfernt), Checklisten (Annahmeprotokoll mit Unterschrift, eigene Vorlagen), Reifenwechsel-Kreis (Ein-/Ausbuchen, Etiketten mit QR-Code), Kalender für Handy und Tablet, Kalender-Abo (iCal), Terminzettel, Halterwechsel und Archiv statt Löschen.
* **Büro:** Angebote, Auftragsbestätigungen, Abschlags- und Schlussrechnungen, Festschreiben und Storno per Gegenbeleg, E-Rechnung (XRechnung) als getrennter Download, Versand per E-Mail; Berichte (Umsatz, offene Posten, Auslastung); Zeiterfassung (Stempeln, Nachtragen, Übernahme in Aufträge); Mitarbeiter mit Teilzeit und Urlaubsstand; Feiertage nach Region.
* **IT:** Netzwerk-Überwachung (Erreichbarkeit per TCP/HTTP, Verlauf), IT-Tresor (verschlüsselt, Anzeige mit Passwortabfrage).
* **Verwaltung:** E-Mail-Versand, API und Webhooks (Tokens, Dienstkonten, Doku-Seite), Systemstatus, Off-Site-Backup (SFTP/WebDAV, verschlüsselt), Wiederherstellungsschlüssel, Datenaustausch (CSV-Export/-Import), Rollenmaske mit Vorlagen.
* **Sicherheit und Konto:** Zwei-Faktor-Anmeldung (optional), Sitzungen und bekannte Geräte (nur auf Wunsch), Notzugang per Wiederherstellungs-Code, Datenschutz-Auskunft, Einschränken und Anonymisieren von Kunden.
* **App:** installierbar auf Handy und Tablet (HTTPS nötig), Offline-Seite, Nennform in der Oberfläche, größere Bedienelemente auf Touch.

## Geändertes Verhalten (bitte lesen)

* **Wiederherstellung beendet Sitzungen:** Nach **jeder** Wiederherstellung eines Backups sind alle Sitzungen und gemerkten Geräte beendet (einmalige erneute Anmeldung); Webhooks sind aus, API-Tokens widerrufen.
* **Datenbank:** Die Datenbank wird mit `auto_vacuum = INCREMENTAL` angelegt; ein täglicher Job gibt freien Platz zurück (die Datei schrumpft nach Aufräumläufen). Das gilt nur für **neu angelegte** Datenbanken – ein Grund mehr für die Neuinstallation.
* **Neu in Standardrollen:** `employees.sensitive` (Krankheit, Notfallkontakt – Gesundheitsdaten) steckt **nicht mehr** in der Rolle „Geschäftsführung“, ist als „sensibel“ gekennzeichnet und gehört in keine Rolle und keine Vorlage, solange die Leitung es nicht ausdrücklich vergibt (Administratoren haben es). Rollenliste und Sperrseite nennen für Administratoren, dass „alle Rechte“ die ausdrücklich zu vergebenden (Tresor) nicht einschließen.
* **Rechte:** Diese Rechte stehen in **keiner Standardrolle** und werden bewusst vergeben: `invoices.finalize` (Festschreiben), `billing.send` und `mail.send` (Versand), `orders.reopen`, `checklists.reopen`, `time.viewAll`, `time.correctAll`, `reports.export`, alle Export-/Import-Rechte, `customers.disclose`, `customers.privacy`, `network.monitor`. Die **Tresor-Rechte** gelten nur, wenn eine Rolle sie ausdrücklich enthält – **auch Administratoren haben sie nicht automatisch**. Kein API-Token kann diese Rechte tragen. `reports.view` haben Geschäftsführung und Büro.
* **Kundendaten:** Telefon des Halters und Ort des Kunden sehen nur Personen mit `customers.view`; Kennzeichen suchen in der Kundenliste nur mit `vehicles.view`. Eingeschränkte Kunden (Art. 18) erscheinen nirgends mehr in Auswahl, Suche, Export, API und Kalender-Abo.
* **Zeit:** Die **Werkstatt-Zone** (Einstellungen) bestimmt „heute“ und alle Uhrzeiten; die Zeitzone des Servers ist ohne Bedeutung. Kalendertage werden als Mittag der Werkstatt-Zone gespeichert; ein Zonenwechsel kann bei weit entfernten Zonen gespeicherte Tage um einen Tag verschieben.
* **Gerätestatus** im Netzwerk kommt nur aus Messungen („Status unbekannt“, solange nichts gemessen wurde); die frühere Demo-Anzeige ist entfernt. Die Überwachung ist standardmäßig aus.
* **Hinweise statt Sperren:** Kennzeichen-Dubletten, Feiertage, Öffnungszeiten, Abwesenheit und ein schon terminiertes Fahrzeug sind Hinweise ohne Sperre; hart bleibt nur die Doppelbelegung eines Arbeitsplatzes.
* **Fahrzeuge** lassen sich nur ohne Geschichte löschen (sonst archivieren). Ein **Halterwechsel** zieht offene Termine nach. **IP-Adressen** sind je Netz eindeutig (dieselbe Adresse in einem anderen Netz ist erlaubt).
* **Rechnungen:** Festgeschriebene Ausgangsrechnungen sind unveränderlich und nicht löschbar; Korrektur nur per Gegenbeleg. Beim Festschreiben (und beim Storno) werden PDF und – wenn vollständig – XRechnung als **Original** abgelegt; die Seite zeigt es gekennzeichnet, die „neu erzeugte Ansicht“ (aktuelles Logo und Layout) ist davon getrennt. Das Original geht beim Versand hinaus, ist in jedem Backup enthalten und wird erst mit der Anonymisierung des Kunden gelöscht. Kein ZUGFeRD/PDF/A-3.
* **Abo-Adressen** des Kalenders erlöschen bei Passwortwechsel, Deaktivierung, Notzugang, „Überall abmelden“, Rechteverlust „Termine ansehen“ und nach jeder Wiederherstellung. **Etiketten** (QR-Codes) brauchen die Einstellung „Adresse der Anwendung“.
* **Sitzungen und Tokens:** Passwortwechsel, Notzugang, Deaktivierung und „Überall abmelden“ widerrufen alle API-Tokens des Kontos (Dienstkonten ausgenommen: ihre Schlüssel enden nur durch Widerruf, Ablauf – oder nie, wenn „Unbegrenzt“ gewählt wurde –, Ausschalten oder Löschen des Kontos). Nach **jeder Wiederherstellung** sind Webhooks aus und Tokens widerrufen. Der Notzugang setzt einen eingerichteten zweiten Faktor zurück.
* **Backups:** Aufbewahrung je Art einstellbar (Standard: `pre-*`-Sicherungen bleiben 5), das neueste Backup überhaupt bleibt immer. Eine Wiederherstellung **ohne** Wiederherstellungsschlüssel setzt Update-Token, Off-Site-Zugang, Webhook-Geheimnisse und zweiten Faktor zurück (mit Sicherung der Zeilen unter `secret-reset/`). **Der IT-Tresor wird dabei nie zurückgesetzt:** Er hängt nicht mehr an der Schlüsseldatei des Servers (siehe „Änderungen seit dem Entwurf“), bleibt nach der Wiederherstellung gesperrt und ist mit der Tresor-Passphrase wieder lesbar.
* **Oberfläche:** Anrede in der Nennform, dunklere Ränder von Eingabefeldern, die Übersicht zeigt die vier wichtigsten Bausteine (Rest zugeklappt), Kürzel der Abwesenheit (U Urlaub, K Krank, S Schulung, X Sonstiges, A abwesend), das Abwesenheitsraster erscheint unter 768 px nicht (Liste und Knopf bleiben). Das **JS-Budget** je Seite ist um etwa 105 KB gewachsen (565 → 670 KB).
* **Anmeldung:** „Dieses Gerät merken“ nur auf Wunsch (nie vom Passwort oder zweiten Faktor befreit); Leerlauf-Frist und Pflicht-2FA für Administratoren sind Standard aus.
* **Technisch:** SVG-Logos werden nicht mehr angenommen (Standardmarke), das Logo ist ohne Anmeldung abrufbar; Doku-Bild-Upload verlangt `Content-Length`; hinter einem Reverse-Proxy mit umgeschriebenem Host die Einstellung „Hinter Reverse-Proxy“ (`X-Forwarded-Host`); Off-Site-Dateien `.sobk` Version 2; Webhooks, Off-Site, E-Mail und Überwachung erreichen den **Docker-Host nicht mehr** – für alle vier gilt dieselbe Zielregel, auch mit der Freigabe privater Netze.

## Änderungen seit dem Entwurf (Fix-Runde 13e, bitte beachten)

* **Neuinstallation nötig** bleibt: Schema und Baseline haben sich geändert (`updatedAt`/Version an sechs Konfigurationstabellen, `Restrict` statt `Cascade` auf Historie, `auto_vacuum`, Versionsangabe der Suchspalten); es gibt weiterhin keine Migration von 0.1.0.
* Bedienung: „Auftrag aus Termin“ und „Terminzettel“ stehen auch im Bearbeiten-Dialog eines Termins; die Prüfliste einer Rechnung verlinkt fehlende Punkte und kann die Anschrift aus dem Kunden neu übernehmen; Diagramme bleiben am Handy lesbar; Meldungen nennen Auftrag, Beleg oder Funktion; Stempeln wird angesagt; der Fokus bleibt nach Aktionen auf der Seite.
* Datenschutz: Das **Audit-Log bleibt bei der Anonymisierung unverändert**. Neue Einträge zu Kunden und Mitarbeitern nennen keinen Namen, sondern Art und Kennung; Namen aus früheren Fassungen blieben bis zur Audit-Aufbewahrungsfrist (Standard 730 Tage, 0 = dauerhaft) stehen – Hinweis an die Datenschutzberatung. Die **Urlaubsberechnung** ist eine Vereinfachung (kein Ersatz für Rechtsprüfung; Wartezeit und Austritt nach dem 30.6. nicht automatisch; der Verfall des Übertrags ohne Hinweis des Arbeitgebers nach § 7 BUrlG wird nicht abgebildet).

* **IT-Tresor – neues Schlüsselkonzept:** Die Zugangsdaten sind mit einem Schlüssel verschlüsselt, der aus einer **Tresor-Passphrase** entsteht und nur im Speicher der Anwendung liegt. Die Passphrase wird beim ersten Öffnen des Tresors festgelegt (Recht „Tresor verwalten“); **nach jedem Neustart der Anwendung ist der Tresor gesperrt**, bis eine berechtigte Person die Passphrase einmal eingibt (zusätzlich zum eigenen Passwort; falsche Eingaben werden für alle gemeinsam gebremst, jede Entsperrung steht im Audit-Log). Bei vergessener Passphrase öffnet der **Wiederherstellungsschlüssel** den Tresor – ein neuer Wiederherstellungsschlüssel lässt sich deshalb nur bei entsperrtem Tresor erzeugen. Die Passphrase lässt sich ändern, ohne die Einträge neu zu verschlüsseln; nur wenn beides verloren ist, bleibt „Tresor zurücksetzen“ (mit Sicherung der Zeilen). Ein Restore berührt den Tresor nie.
* **Originalrechnung:** PDF und XRechnung werden beim Festschreiben und beim Storno als unveränderliche Datei abgelegt (siehe oben); die „neu erzeugte Ansicht“ ist davon getrennt gekennzeichnet.
* **Rechnungsarchiv und Art. 18:** Festgeschriebene Rechnungen eingeschränkter Kunden bleiben im Archiv lesbar (Aufbewahrungspflicht) – nur mit dem Recht „Rechnungen ansehen“, mit dem Hinweis „Verarbeitung eingeschränkt (Aufbewahrungspflicht)“ und mit Namen nur für „Kunden ansehen“; in Schnellsuche, Auswahl, Exporten und der Schnittstelle fehlen sie.
* **Dienstkonten:** Ein Dienstkonto arbeitet nur mit API-Schlüsseln (kein Passwort, keine Anmeldung); jeder Schlüssel ist einzeln widerrufbar und hat seine Laufzeit – 30 bis 365 Tage oder **unbegrenzt** (nur für Dienstkonten; ein vergessener unbegrenzter Schlüssel bleibt gültig, bis er widerrufen wird).
* **Audit-Log unverändert:** Die Anonymisierung ändert nie Einträge. Neue Einträge nennen Kunden und Mitarbeiter nur mit Art und Kennung; Namen aus früheren Fassungen bleiben bis zur Audit-Aufbewahrungsfrist (Standard 730 Tage, 0 = dauerhaft) stehen – Hinweis an die Datenschutzberatung.
* **Einrichtung:** Das Preset „Werkstattalltag“ schaltet jetzt auch die Rechnungserstellung ein (Warnhinweis: vor dem produktiven Einsatz vom Steuerberater freizugeben).
* **Einheitliche Namen (vor dem Freeze, keine Rückwärtskompatibilität):** Rechtegruppen heißen wie ihre Funktion (`docs.*` der IT-Dokumentation statt `docsIt.*`, `manual.*` des Handbuchs statt `handbook.*`), Audit-Gruppen stehen im Singular (`order.*`, `tire.*`, `part.*`, `file.*`, `checklist.*`), das Webhook-Ereignis heißt `order.statusChanged`, Zeitraum-Filter der Schnittstelle überall `from`/`to` (Rechnungen: nicht mehr `issuedFrom`/`issuedTo`), die VLAN-Nummer im Netzwerk heißt `number`.
* **Kleinere Verbesserungen:** Hilfe-Symbol immer am Ende der Titelzeile; Seitentitel folgen der Überschrift (Rechnung aus Auftrag, Einstellungen mit Reiter, „Kein Zugriff“); einheitliches Datumsformat mit vierstelligem Jahr; das Wochenraster nennt ausgeblendete geschlossene Tage und leere Wochen und beschriftet die erste Stunde; erzeugte PDFs sind getaggt (Überschriften, Absätze, Bilder mit Alternativtext); Positionsnamen höchstens 200 Zeichen (PDF und XRechnung zeigen denselben Text); die XRechnung prüft vorab Telefon (mindestens drei Ziffern) und E-Mail-Form.

## Für Betreiber

* Image: `ghcr.io/veniplex/schrauberos:0.2.0` (auch `0.2`, `latest`). Gehärteter Betrieb: `docker-compose.hardened.yml`. HTTPS (Reverse-Proxy) ist für die installierbare App nötig.
* Das Paket enthält Anwendung, Laufzeit und Launcher; der Starter prüft installierte Versionen bei jedem Start gegen Siegel und Dateiliste. Releases sind mit einer Schlüsselkette (Wurzel- und Release-Schlüssel) signiert.
* Neue Abhängigkeiten: `pdfkit`, `fontkit`, `nodemailer`, `ssh2`, `qrcode-generator` (alle exakt gepinnt, ohne native Teile).

## Bekannte Grenzen (bewusst so in 0.2.0)

* **Dauerbeschuss der Anmeldung (L1):** Die Wartezeit eines Kontos gilt für alle Quellen gemeinsam (bis 90 s, keine harte Sperre). Fragt jemand ein Konto im Takt ab, kommt die Besitzerin kaum durch. **Wege:** das gemerkte Gerät (befreit von der Konto-Wartezeit, nie vom Passwort oder zweiten Faktor) und der Notzugang (Wiederherstellungs-Code). Eine Lösung (Wartezeit je Quelle) folgt in **0.2.1**.
* **Meldungswörterbuch im Browser (M-2):** Das gesamte Wörterbuch (≈ 286 KB, gzip ≈ 89 KB) geht mit jedem Dokumentaufruf an den Browser; die Aufteilung nach Bereichen folgt in **0.2.1** (kein Format- oder Schemaeinfluss).
* **Nicht gebaut:** Verzeichnis der Verarbeitungstätigkeiten (Art. 30 DSGVO) als Funktion der Anwendung, ein Löschkonzept für Beschäftigte (Mitarbeiterdaten, Abwesenheiten, Qualifikationen, Notfallkontakte), und die Option „Urlaubsverfall nur nach Hinweis des Arbeitgebers“ (§ 7 BUrlG) in der Urlaubsberechnung.

## Noch offen (vor dem Veröffentlichen prüfen, dann streichen)

* **Fachliche Freigabe durch den Steuerberater:** Rechnungserstellung (Pflichtangaben, Kleinunternehmer-Text, 0 %-Positionen, Anrechnung von Abschlägen – Darstellung in Schlussrechnung und Storno –, Storno ohne Fälligkeit, Form und Dauer der Aufbewahrung der Originalrechnungen), XRechnung (nie gegen den KoSIT-Prüfer gelaufen; der Pipeline-Job tut es), Aufbewahrungsfristen (Platzhalter; die Anonymisierung bleibt gesperrt, bis ein Administrator sie bestätigt), Umsatz-Definition der Berichte, Kassenhinweis.
* **Datenschutzberatung:** Ob eine Audit-Aufbewahrung von 730 Tagen für Einträge früherer Fassungen mit Namen genügt.
* **Daten ohne Primärquelle:** Feiertage der Schweizer Kantone und österreichischen Landesfeiertage, Arbeitszeit-Schwellen, Drehmomentwerte der Checklisten-Vorlagen.
* **Rechte:** Notausschalter für die Pflicht-2FA.

## Realgeräte-Ergebnis

| Gerät | Version | Browser | Ergebnis |
| --- | --- | --- | --- |
| iPhone | | Safari | |
| Android | | Chrome | |
| iPad | | Safari | |
