# Funktionen im Überblick

Was die einzelnen Funktionen können und welche Regeln dahinterstehen. Die Auflistung aller Module, Funktionen, Rechte und Abhängigkeiten steht im Kapitel *Katalog*.

## Rechte, Rollen und Benutzer

* Berechtigungen sind Strings der Form `modul.aktion` (z. B. `tires.edit`). Rollen bündeln sie; Benutzer können mehrere Rollen haben, die Rechte addieren sich. In der Rollenverwaltung sind sie nach Modul und Funktion gegliedert; Rechte ausgeschalteter Funktionen werden markiert und wirken erst nach dem Wiedereinschalten.
* Rollen mit `isAdmin` haben immer alle Rechte (auch künftige).
* Mitgelieferte Rollen: Administrator, Geschäftsführung, Büro / Verwaltung, Serviceberater, Mechaniker, Lager, IT-Administrator. Jede Rolle sieht nur ihre Bereiche – z. B. sehen IT-Admins keine Kunden/Rechnungen, das Büro nicht den IT-Bereich, Mechaniker nur Werkstatt.
* Dokumentation hat je Bereich eigene Rechte (`docsWorkshop`, `docsOffice`, `docsIt`: lesen/bearbeiten).
* Schutzregeln: der letzte aktive Administrator kann weder gelöscht noch deaktiviert werden; Admin-Rollen dürfen nur von Admins vergeben werden; das eigene Konto kann nicht deaktiviert werden.
* Fünf Fehlversuche sperren ein Konto für 15 Minuten. Passwortänderung oder Deaktivierung beendet bestehende Sitzungen.
* `roles.manage` und `users.manage` sind faktisch administrative Rechte (damit lassen sich Rechte erweitern) – entsprechend sparsam vergeben.

### Active Directory (später)

Jeder Benutzer hat eine `authSource` (`local` oder z. B. `ldap`). Für AD genügt es, in `src/server/auth/providers.ts` einen `AuthProvider` zu implementieren und zu registrieren; Rollen und Rechte bleiben in der eigenen Datenbank (z. B. Zuordnung AD-Gruppe → Rolle beim ersten Login). Die Benutzerverwaltung zeigt externe Konten bereits an und blendet Passwortfelder dafür aus.

## Werkstatt

* **Fahrzeuge** sind eigenständig und brauchen keinen Kunden. Der Halter wechselt über „Halterwechsel“ (Datum, Notiz, Historie); Reifensätze und Termine bleiben am Fahrzeug. Wird ein Kunde gelöscht, bleiben seine Fahrzeuge ohne Halter erhalten.
* **Reifenlager:** Zustand je Reifen (Profiltiefe, Alter aus dem DOT-Code, Zustand); Grenzwerte stellt man unter Einstellungen → Werkstatt ein.
* **Werkstatt-Dokumentation** (Markdown) für Arbeitsanweisungen, Checklisten, Notfallpläne – wichtige Seiten lassen sich anheften und erscheinen auf der Übersicht.

## Büro

* **Rechnungsarchiv:** Eingang (Lieferanten) und Ausgang (Kunden) getrennt, Status offen/bezahlt/storniert, „überfällig“ wird aus der Fälligkeit berechnet, Summen je Richtung und Jahr, Dopplungsschutz (Nummer + Partner), Netto + MwSt. werden gegen Brutto geprüft. Der **Beleg (PDF/PNG/JPEG/WebP, max. 10 MB)** liegt in der Datenbank und wird nur mit dem Recht `invoices.view` ausgeliefert.
* **Mitarbeiter:** Stammdaten, Zuordnung zu einem Benutzerkonto (jedes Konto nur einmal, beide Seiten verlinkt), Qualifikationen mit Ablaufdatum, Urlaubstage-Übersicht (Mo–Fr, Feiertage werden nicht abgezogen). **Besonders schützenswert** (Recht `employees.sensitive`): Notfallkontakt und Krankheit – ohne das Recht erscheinen Krankheitstage nur als neutrale „abwesend“-Einträge.
* **Fuhrpark:** Firmenwagen mit Fahrer (Mitarbeiter), Fälligkeiten (HU, Service nach Datum/Kilometer, Versicherung, Leasing – Warnung 60 Tage vorher), Kilometerverlauf (Rückwärtssprünge werden abgelehnt), Kosten je Kategorie mit Kosten pro Kilometer, **Führerscheinkontrolle** (Halterpflicht, Intervall 6 Monate, „nie kontrolliert“ wird rot markiert).
* **Büro-Dokumentation** (Markdown) für Abläufe, Vorlagen, Ansprechpartner.

## IT & Netzwerk

Eigenes Modul (Funktion `it.network`, Code in `src/modules/it/network/`), sichtbar nur mit dem Recht `network.view`.

* **Geräte:** Inventar mit Art, Hersteller/Modell, Seriennummer, Standort/Rack, Garantie (Hinweise bei abgelaufen/bald ablaufend), Notizen. Zugangsdaten werden bewusst **nicht** gespeichert.
* **IP-Verwaltung:** VLANs, Subnetze (IPv4, /16–/30) mit Auslastung, Adressen (statisch, DHCP-Reservierung, reserviert, Gateway), freie Bereiche, „nächste freie Adresse“. Geprüft wird: gültige IPv4, liegt im Subnetz, keine Dopplung, gültige MAC.
* **Verkabelung:** Kabelliste (Gerät/Port ↔ Gerät/Port), Port-Übersicht bei Geräten mit Port-Anzahl (Switch/Patchfeld), ein Port kann nur einmal belegt werden. Standorte/Räume werden unter „Verkabelung & Standorte“ gepflegt.
* **Erreichbarkeit (Demo):** Die Status-Anzeige (online/langsam/offline, Dashboard-Widget und Übersicht) ist **simuliert** und überall als „Demo“ gekennzeichnet – es findet kein Netzwerkzugriff statt. Die Schnittstelle dafür ist `StatusProvider` in `src/modules/it/network/monitoring.ts`; für echte Checks (Ping/Port, Zeitplan, Verlauf) wird dort ein weiterer Anbieter implementiert und in `getStatusProvider()` ausgewählt. Dabei beachten: Der Docker-Container muss die Geräte im LAN erreichen können.
* **IT-Dokumentation** (Markdown) für Anleitungen, Konzepte, Betriebswissen.

## Dokumentation (Markdown)

Je Bereich (Werkstatt, Büro, IT) eine eigene Wissenssammlung unter `/docs/<bereich>` mit eigenen Rechten:

* Markdown mit GitHub-Erweiterungen: Überschriften, Listen, Aufgabenlisten, Tabellen, Code, Zitate, Links, Bilder. Rohes HTML wird **nicht** ausgegeben (kein XSS), gefährliche Link-Ziele werden entschärft.
* Editor mit Werkzeugleiste und Live-Vorschau; Bilder per Knopf hochladen oder aus der Zwischenablage einfügen (PNG/JPEG/WebP/GIF, max. 2 MB, in der Datenbank gespeichert, nur für Leser des jeweiligen Bereichs abrufbar).
* Kategorien, Volltextsuche über Titel und Inhalt, Inhaltsverzeichnis, Anheften (Übersicht), **Versionsverlauf** mit Wiederherstellen (letzte 30 Fassungen je Seite).
* Die Adresse (Slug) einer Seite bleibt stabil, auch wenn der Titel geändert wird.

## Audit-Log

Unter **Verwaltung → Audit-Log** (Recht `audit.view`) steht, wer wann was getan hat: Anmeldungen (auch fehlgeschlagene) und Abmeldungen,
Passwort- und Profiländerungen, Anlegen/Ändern/Löschen von Benutzern und Rollen, Ein-/Ausschalten von Modulen und Funktionen,
Änderungen an Einstellungen sowie Löschungen von Kunden, Fahrzeugen, Reifensätzen, Terminen, Rechnungen, Mitarbeitern, Fuhrpark-Einträgen,
Netzwerk-Geräten und Dokumentationsseiten. Die Liste lässt sich nach Benutzer/Objekt und Aktionsgruppe filtern.

* Der Eintrag speichert den **Namen** des Handelnden zum Zeitpunkt der Aktion – der Verlauf bleibt auch nach dem Löschen eines Benutzers lesbar.
* Geschrieben wird immer, auch wenn die Funktion „Audit-Log“ ausgeschaltet ist; ausgeschaltet ist nur die Ansicht.
* Neue Aktion protokollieren: in `src/lib/audit-actions.ts` eintragen, Beschriftung unter `audit.actions.*` (de/en) ergänzen und
  `await audit("…", { target })` aus `@/server/audit` in der Server Action aufrufen. Der Katalog-Test prüft die Beschriftungen.
* Es gibt noch keine automatische Aufbewahrungsfrist; die Tabelle `AuditLog` wächst mit der Nutzung.

## Demo-Daten

`SEED_DEMO=true` legt Beispieldaten für alle Bereiche an (Kunden, Fahrzeuge inkl. Halterwechsel und einem Fahrzeug ohne Halter, Reifen, Termine, Netzwerk, Mitarbeiter mit Abwesenheiten/Qualifikationen, drei Firmenwagen, Rechnungen, Doku-Seiten). In Produktion (`SEED_DEMO=false`) starten alle Bereiche leer.

## Werbas-Anbindung (später)

Kunden und Fahrzeuge tragen `externalSource`/`externalId`/`syncedAt`. `src/server/integrations/werbas/` enthält das neutrale Austauschformat (`types.ts`) und die Abgleichslogik (`sync.ts`, Upsert über `externalId`, lokale Datensätze bleiben unberührt, Reifen/Termine hängen an denselben Fahrzeug-IDs).
Offen ist nur `client.ts`: sobald klar ist, wie Werbas Daten bereitstellt (REST, Datenbank-Sicht, Export-Datei), wird dort ein `WerbasClient` implementiert und per Skript/Scheduler aufgerufen.

## Bekannte Grenzen / nächste Ideen

* Listen (Kunden, Reifen, Rechnungen) laden bis zu 100–300 bzw. alle Datensätze und filtern teils im Speicher – für typische Betriebsgrößen in Ordnung, bei Bedarf Pagination ergänzen.
* Belege und Bilder liegen in der Datenbank (einfaches Backup, kein extra Speicher) – bei sehr großem Archiv wäre ein Objektspeicher/Volume die Alternative.
* Urlaubstage zählen Mo–Fr ohne Feiertage; es gibt keinen Genehmigungs-Workflow für Urlaubsanträge.
* Noch nicht enthalten: E-Mail/SMS-Erinnerungen (Fälligkeiten erscheinen nur im Dashboard), Druck-Etiketten/QR-Codes für Lagerplätze, Ressourcen-Kalender pro Mitarbeiter, echte Netzwerk-Überwachung.
* Die Anmeldung ist rein lokal (siehe oben für AD); Zwei-Faktor ist nicht vorgesehen.
