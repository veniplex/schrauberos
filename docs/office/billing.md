# Angebote & Rechnungen

Hier erstellen Sie **Angebote, Auftragsbestätigungen und Rechnungen** (auch Abschlags- und Schlussrechnungen) und senden sie auf Wunsch per E-Mail. Rechnungen erscheinen nach dem Festschreiben in der **Ausgangsliste des Rechnungsarchivs** – dort stehen auch die von Hand erfassten Rechnungen, es gibt keinen zweiten Bestand. Die Funktion ist standardmäßig ausgeschaltet und wird unter *Module & Funktionen* eingeschaltet.

> **Hinweis:** Die Anwendung unterstützt die Rechnungsstellung, ersetzt aber keine Steuerberatung. Prüfen Sie Belegtexte, Steuersätze, Aufbewahrung und die Frage, ob Sie Kleinunternehmer sind, mit Ihrer Steuerberatung.

## Vorbereitung: das Werkstattprofil

Unter *Einstellungen › Werkstatt* tragen Sie ein, was auf jeder Rechnung stehen muss: **Name und Anschrift**, **Steuernummer oder USt-IdNr.**, **IBAN** (für die Überweisung und den Girocode), Telefon und E-Mail (für die XRechnung), Geschäftsführer, Register, Standard-Zahlungsziel und das **Muster der Rechnungsnummer** (z. B. `{YYYY}-{NNNN}`). Der Einrichtungspunkt „Werkstattprofil für Rechnungen vervollständigen“ hakt sich von selbst ab. Die **Kleinunternehmer-Einstellung (§ 19 UStG)** gilt für alle neuen Belege: keine Umsatzsteuer, der Pflichthinweis steht auf Beleg und PDF.

## Belegarten

* **Angebot** – mit Gültigkeitsdatum. Status: *offen*, *angenommen*, *abgelehnt* oder – wenn die Gültigkeit vorbei ist – *abgelaufen*.
* **Auftragsbestätigung** – entsteht aus einem **angenommenen** Angebot (Knopf im Angebot); je Angebot eine.
* **Rechnung** – frei erfasst oder aus einem Auftrag.
* **Abschlagsrechnung** – eine Teilforderung vorab. **Schlussrechnung** – die Gesamtleistung; bei den Abschlägen wählen Sie die bereits gestellten Abschlagsrechnungen des Kunden aus, sie werden abgezogen (zu zahlen ist der Rest). Ein Abschlag lässt sich nur einmal anrechnen.
* **Stornorechnung** – der Gegenbeleg zu einer festgeschriebenen Rechnung (siehe unten).

## Entwurf, Nummer und Festschreiben

Ein **Entwurf** hat **keine Nummer** und ist frei änderbar und löschbar. Erst **Festschreiben** (Rechnungen) bzw. **Ausstellen** (Angebote, Auftragsbestätigungen) vergibt die **fortlaufende Nummer** – aus einem Zähler, ohne Lücken. Gleichzeitig hält die Anwendung **Absender (Werkstattprofil) und Empfänger** als Schnappschuss auf dem Beleg fest: Ändert sich später das Profil oder der Kunde, ändert sich dieser Beleg nicht. Das Rechnungsdatum ist der Tag des Festschreibens, die Fälligkeit ergibt sich aus dem Zahlungsziel.

Rechnungen haben eine eigene, durchgehende Nummernreihe (Rechnung, Abschlag, Schlussrechnung und Stornorechnung zählen gemeinsam); Angebote (`AN-JJJJ-NNNN`) und Auftragsbestätigungen (`AB-JJJJ-NNNN`) haben je eine eigene. Haben Sie im Rechnungsarchiv von Hand eine Nummer vergeben, die der Zähler als Nächstes verwenden würde, überspringt er sie – eine Nummer wird nie doppelt vergeben.

Vor dem Festschreiben zeigt die Seite eine **Prüfliste der Pflichtangaben** (Anschriften, Steuernummer oder USt-IdNr., Leistungsdatum oder -zeitraum, Zahlungsziel, IBAN, Positionen, bei 0 %-Positionen ein Hinweis zur Steuerbefreiung). Fehlt etwas, lässt sich nicht festschreiben. Festschreiben braucht das Recht *Ausgangsrechnungen festschreiben*, das in keiner mitgelieferten Rolle steckt; Angebote darf stellen, wer Belege bearbeiten darf. **Das Festschreiben lässt sich nicht rückgängig machen**: Inhalt, Beträge, Empfänger und Absender sind danach unveränderlich, der Beleg ist nicht mehr löschbar. Zahlungen, der Angebotsstatus und der Versandvermerk bleiben veränderlich.

Eine **Rechnung bis 250 € brutto** (Kleinbetragsrechnung) behandelt die Anwendung wie jede andere; die Hinweise der Steuerberatung dazu gelten unverändert.

## Positionen und Steuer

Positionen haben Art (Arbeit, Teil, Sonstiges), Menge, Einheit, **Netto-Einzelpreis**, Steuersatz (**19 %, 7 % oder 0 %**) und Rabatt. Die Steuer wird **je Steuersatz auf der Summe** gerundet. Positionen mit 0 % brauchen einen Hinweis zur Steuerbefreiung. Beim Kleinunternehmer ist der Steuersatz fest 0 %; auf dem Beleg steht „Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG“. Ist Teile & Lager aktiv, lassen sich Artikel einfügen.

## Angebot → Auftrag → Rechnung

* **Angebot annehmen:** Das Angebot als angenommen vermerken (Recht *Angebote annehmen*).
* **Auftrag anlegen:** Aus einem angenommenen Angebot mit Fahrzeug legt ein Klick den **Auftrag** an – Nummer, Positionen und Verknüpfung entstehen gemeinsam, schlägt ein Teil fehl, entsteht nichts.
* **Rechnung aus Auftrag:** Im Auftrag (und unter *Neu*) – Kunde, Fahrzeug und alle Positionen samt Zeiten werden übernommen. Der Auftrag sollte abgeschlossen sein; sonst fragt die Seite ausdrücklich nach. Gibt es zum Auftrag schon eine Rechnung, fragt sie ebenfalls ausdrücklich, bevor sie noch einmal abrechnet.

## PDF, Druck und Girocode

Zu jedem Beleg gibt es ein **PDF** (Öffnen, Teilen, Herunterladen; am Rechner Vorschau). Es enthält Absender, Empfänger, Positionen, Summen, Pflichthinweise, die Bankverbindung und – bei Überweisung – einen **Girocode** zum Scannen mit der Banking-App. Entwürfe tragen den Vermerk „Entwurf“. Das PDF ist ein normales PDF (kein PDF/A-3, keine eingebettete XML).

## XRechnung

Für Behörden und Geschäftskunden erzeugt die Anwendung auf Wunsch die **XRechnung** (XML, Syntax UBL) als eigene Datei. Dafür braucht der Beleg die **Käuferreferenz bzw. Leitweg-ID**, die E-Mail des Empfängers sowie Telefon und E-Mail der Werkstatt; die Seite listet, was noch fehlt. Für Privatkunden ist sie nicht nötig.

## Zahlungen

Bei festgeschriebenen Rechnungen erfassen Sie **Zahlungseingänge** mit Betrag, Datum und Zahlungsart – auch Teilzahlungen. Der Restbetrag und der Zahlstatus (*offen*, *teilweise bezahlt*, *bezahlt*, *überfällig*) ergeben sich von selbst. Eine falsche Erfassung entfernen Sie wieder; das steht im Audit-Log. *Hinweis:* Die Anwendung ist keine Kasse im Sinne der Kassensicherungsverordnung – wer bar kassiert, lässt fachlich prüfen, ob ein zertifiziertes System nötig ist.

## Stornorechnung

Eine festgeschriebene Rechnung korrigieren Sie mit der **Stornorechnung** (Knopf am Beleg, Recht *Rechnungen bearbeiten*): ein eigener Beleg mit Bezug auf die Rechnung, alle Beträge mit umgekehrtem Vorzeichen, **eigener Nummer aus dem Nummernkreis**. Rechnung und Stornorechnung zählen danach nicht mehr in den offenen Beträgen. Ein Abschlag, den eine festgeschriebene Schlussrechnung anrechnet, lässt sich erst nach deren Storno stornieren. *Hinweis:* Bestandsbuchungen der Teile werden durch eine Stornorechnung **nicht** automatisch rückgängig gemacht – das korrigieren Sie im Lager.

## Per E-Mail senden

Ist der E-Mail-Versand eingerichtet und hat der Kunde eine E-Mail-Adresse, bietet der Beleg **„Per E-Mail senden“** (Recht *Belege per E-Mail senden* und zusätzlich *E-Mails senden*; beide stehen in keiner mitgelieferten Rolle). Empfänger ist die E-Mail des Kunden; Betreff und Text stammen aus einer festen Vorlage, das PDF (auf Wunsch die XRechnung) hängt an. Wiederholter Versand verlangt eine ausdrückliche Bestätigung. Ohne E-Mail-Adresse bleiben PDF, Druck und Download. Das **Sendeprotokoll** nennt Empfänger und Betreff und gehört zu den personenbezogenen Daten des Kunden (Auskunft und Anonymisierung berücksichtigen es).

## Aufbewahrung

Rechnungen und Buchungsbelege sind aufzubewahren; die Fristen (hier als Platzhalter 8 bzw. 10 Jahre) legen Sie unter *Einstellungen › Datenschutz* fest und lassen sie von Ihrer Steuerberatung bestätigen. Das Festschreiben schützt Belege vor versehentlichen Änderungen. Eine Zusage, dass damit bestimmte Anforderungen an die Buchführung erfüllt sind, gibt die Anwendung nicht – ein Verfahren zur Aufbewahrung ersetzt sie nicht; das klärt die Steuerberatung. Eine Sicherung (Backup) der Daten ist Teil Ihrer Aufbewahrung; beim Zurückspielen eines Backups entspricht der Stand dem Zeitpunkt der Sicherung.

## Rechte

*Angebote und Rechnungen ansehen*, *bearbeiten* (Entwürfe, Angebote ausstellen, Rechnung aus Auftrag), *Angebote annehmen*, *Belege per E-Mail senden* (gekennzeichnet) sowie – aus dem Rechnungsarchiv – *Ausgangsrechnungen festschreiben* (gekennzeichnet) und *Rechnungen bearbeiten* (Zahlungen, Stornorechnung). Belege von Kunden mit eingeschränkter Verarbeitung lassen sich nicht neu anlegen, festschreiben oder versenden.
