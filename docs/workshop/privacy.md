# Datenschutz bei Kunden

Die Anwendung speichert personenbezogene Daten von Kunden (Name, Anschrift, Telefon, E-Mail, Fahrzeuge, Termine, Aufträge, Rechnungen, Fotos und Dateien, Notizen). Für Anfragen von Kunden gibt es auf der **Kundenseite** die Karte **Datenschutz**. Sie ist nur sichtbar, wenn Sie die zugehörigen Sonderrechte haben (*Auskunft über einen Kunden exportieren* und *Datenschutz: Verarbeitung einschränken und Kunden anonymisieren*); beide stehen in keiner mitgelieferten Rolle und lassen sich nicht an eine Programmierschnittstelle vergeben. Alles, was dort geschieht, steht im Audit-Log.

## Auskunft (Art. 15 DSGVO)

**Auskunft exportieren** liefert alle zu einem Kunden gespeicherten Daten – als **CSV** (Excel) oder als **JSON**:

* Stammdaten mit allen Feldern, auch Notizen,
* Fahrzeuge, die der Kunde hält, und die **Halterhistorie** (auch frühere Fahrzeuge),
* Termine mit Titel und Notizen,
* Reifensätze seiner Fahrzeuge mit Notizen,
* **Aufträge** (Kundenwunsch, Befunde, Freigaben mit Betrag, freigebender Person, getipptem Namen und Hinweis auf die gespeicherte Unterschrift), **Checklisten** (Kundenname und getippter Name der Unterschrift, Anmerkungen, Freitexte der Punkte) und die **Liste der Dateien und Fotos** an seinen Fahrzeugen und Aufträgen (Name, Beschriftung, Zeitpunkt – nicht der Bildinhalt; Bilder und PDFs geben Sie bei Bedarf getrennt heraus),
* Rechnungen, die mit dem Kunden verknüpft sind (Empfänger, Beträge, Daten, Notizen),
* **Fundstellen in der Dokumentation**: Seiten (und frühere Versionen), auf denen Name, Firma, Kundennummer oder E-Mail-Adresse vorkommen – nur mit Titel und Datum, nicht mit dem Inhalt.

Die Auskunft enthält nur, was in der Anwendung steht – bei Aufträgen, Checklisten und Dateien bewusst alles, unabhängig davon, welche Leserechte Sie sonst haben. Rechnungen ohne Verknüpfung zum Kunden (nur der Name als Text) erscheinen nicht; Daten in ausgeschalteten Funktionen ebenfalls nicht. In der CSV-Datei beginnen Zellen, die mit `=`, `+`, `-` oder `@` anfangen, mit einem vorangestellten `'`, damit Excel sie nie als Formel ausführt. Die Datei enthält personenbezogene Daten: nur an den Betroffenen übergeben, nicht unverschlüsselt mailen.

## Verarbeitung einschränken (Art. 18 DSGVO)

**Verarbeitung einschränken** sperrt den Kunden, ohne etwas zu löschen. Danach

* erscheint er nicht mehr in Suche, Auswahlfeldern (Termin, Fahrzeug, Rechnung), Schnellsuche, der Standard-Kundenliste und in den CSV-Exporten, und die Programmierschnittstelle (und spätere Webhooks) kennt ihn nicht mehr,
* lässt er sich nicht mehr neu verknüpfen (neuer Termin mit diesem Kunden, Halterwechsel auf ihn, neue Rechnung an ihn); bestehende Verknüpfungen bleiben,
* bleibt er auf seiner **Kundenseite** sichtbar – mit einem Hinweis, seit wann die Verarbeitung eingeschränkt ist, und der Notiz zum Anlass.

Auffindbar ist er über den Listenfilter **Eingeschränkt** (und „Alle“). Nutzen dürfen Sie die Daten nur mit Einwilligung, zur Geltendmachung von Rechtsansprüchen oder aus anderen gesetzlich erlaubten Gründen. **Einschränkung aufheben** macht den Kunden wieder normal verwendbar. Hinweis: Bereits angelegte Termine und Fahrzeuge des Kunden bleiben in ihren Listen und im Kalender stehen.

## Aufbewahrungsfristen und Anonymisierung (Art. 17 DSGVO)

Rechnungen müssen aufbewahrt werden. Ein Kunde mit Rechnungen lässt sich deshalb nicht löschen. Stattdessen **anonymisiert** die Anwendung nach Ablauf der Frist den **Stammsatz**:

* Name, Firma, Kundennummer, Anschrift, Telefon, E-Mail und Notizen werden gelöscht; der Kunde heißt danach „Anonymisiert“ und ist archiviert.
* **Fahrzeuge** verlieren den Halter und ihre Notiz (Kennzeichen und FIN bleiben), die Halterhistorie bleibt ohne Namen; **Termine** verlieren den Kunden, ihre Notizen werden gelöscht und der Titel wird neutral; die **Notizen der Reifensätze und Reifen** werden gelöscht; bei **Aufträgen** entfallen Kundenwunsch und Befunde, und die Namen der freigebenden Personen im Freigabe-Protokoll werden unkenntlich (Nummer, Positionen, Begründung der Mehrarbeit, Beträge und Zeitpunkte bleiben als Beleg des Vorgangs); bei **Checklisten** werden Kundenname, getippter Name, Anmerkung, Freitexte und Begründungen gelöscht (Vorlage, Messwerte und Haken bleiben); bei **Dateien und Fotos** werden Beschriftungen und Dateinamen unkenntlich gemacht; **Zeiterfassung:** Notiz und Tätigkeit der Zeiten auf den Aufträgen des Kunden entfallen (die Zeiten selbst bleiben). Die Bereinigung gilt auch für **ausgeschaltete Funktionen**, deren Daten ja erhalten bleiben; ebenso nennt die Auskunft die Daten ausgeschalteter Funktionen.
* **Rechnungen** behalten ihren Empfänger (das Feld *Rechnungsempfänger*) und ihre Beträge – sie sind Buchungsbelege. Bei Belegen aus *Angebote & Rechnungen* bleiben Name und Anschrift ebenfalls stehen; **Entwürfe** werden gelöscht, die **E-Mail-Adresse des Empfängers** auf Beleg und Schnappschuss entfällt, und im **Sendeprotokoll** werden Empfängeradresse und Betreff der versendeten Belege unkenntlich gemacht (die als Anhang versendeten PDF- und XML-Dateien werden mit dem nächsten nächtlichen Aufräumlauf vom Dateispeicher gelöst; Backups behalten sie bis zu ihrer eigenen Aufbewahrung). Das Audit-Log nennt bei den Einträgen zu diesen Belegen nur Belegart und Nummer, nie den Namen – **mit einer Ausnahme:** Der Eintrag zum E-Mail-Versand (*E-Mail zum Versand vorgemerkt*) nennt Empfängeradresse und Betreff, und er wird bei der Anonymisierung nicht verändert; er verschwindet mit der Aufbewahrung des Audit-Logs (Standard 730 Tage).
* **Dateien und Unterschriften:** Die Dateien selbst – Fotos, PDFs und die **Unterschrift als Bilddatei** bei Freigaben und Checklisten – bleiben liegen und werden nicht verändert; sie können Personen oder Dokumente zeigen. Wer das nicht möchte, entfernt sie **vorher** am Fahrzeug bzw. Auftrag (entfernte Dateien löscht die Anwendung nach 30 Tagen vom Dateispeicher; Backups behalten sie bis zu ihrer eigenen Aufbewahrung). Für Aufträge und Freigaben sind **noch keine Aufbewahrungsfristen festgelegt** – klären Sie sie mit Ihrem Steuerberater.
* **Dokumentation:** Texte in Handbuch und IT-Dokumentation werden nicht angefasst. Die Fundstellen der Auskunft zeigen, wo der Kunde erwähnt ist – bitte vorher prüfen und die Seiten (auch ihre früheren Versionen) bereinigen.
* **Audit-Log:** Die Einträge zum Kunden selbst (angelegt, geändert, archiviert …) nannten bei der Anlage seinen Namen. Bei der Anonymisierung ersetzt die Anwendung diese Bezeichnung durch „Kunde anonymisiert“; Zeit, Handelnde, Aktion und die Kennung der Sache bleiben, die Nachvollziehbarkeit also auch. **Nicht verändert** wird der Eintrag zum E-Mail-Versand (siehe oben) – er behält Adresse und Betreff, bis die **Aufbewahrungsfrist des Audit-Logs** abläuft (Standard 730 Tage; bei der Einstellung 0 bleibt er dauerhaft). Einträge anderer Funktionen nennen nie den Namen. *Hinweis:* Dass die Anwendung Audit-Einträge bei der Anonymisierung ändert, ist ein Entscheid des Entwicklungsteams; ob das Ihren Vorgaben entspricht, klärt die Datenschutzberatung.
* **Backups** enthalten die Daten weiterhin, bis sie nach ihrer Aufbewahrung gelöscht werden; wird ein älteres Backup wiederhergestellt, ist der Kunde dort noch nicht anonymisiert – die Anonymisierung dann wiederholen. Auch Dateien, die Sie außerhalb der Anwendung aufbewahren (Exporte, versendete Rechnungen), gehören dazu.

**Wann ist die Anonymisierung möglich?** Erst wenn (1) ein **Administrator** unter *Verwaltung → Einstellungen → Datenschutz* die Aufbewahrungsfristen **bestätigt** hat und (2) die Frist **aller** Rechnungen des Kunden abgelaufen ist. Die Frist beginnt mit dem **Ablauf des Kalenderjahres der Rechnung**: Eine Rechnung vom 14.03.2026 mit 8 Jahren Frist ist bis zum **31.12.2034** aufzubewahren und ab 01.01.2035 freigegeben (das Jahr zählt in der Zeitzone der Werkstatt). Das Feld auf der Kundenseite sagt, bis wann gesperrt ist. Kunden ohne Rechnungen lassen sich sofort anonymisieren, sobald die Fristen bestätigt sind.

**Die Fristen** stellt der Administrator unter *Einstellungen → Datenschutz* ein: **Rechnungen und Stornorechnungen** (Standard 8 Jahre) und **festgeschriebene Rechnungen** als Teil der Bücher (Standard 10 Jahre). **Diese Werte sind Platzhalter.** Bitte klären Sie die Fristen mit Ihrem Steuerberater und bestätigen Sie sie erst danach; solange die Bestätigung fehlt – und nach jeder Änderung der Fristen – bleibt die Anonymisierung gesperrt. Die Anwendung ersetzt keine Rechts- oder Steuerberatung.

## Kundennummern

Eine Kundennummer kann doppelt vergeben werden, ist aber meist ein Versehen: Beim Speichern erscheint eine **Warnung** mit Verweis auf den Kunden, der die Nummer schon hat. Mit **Trotzdem speichern** bleibt die Dublette erlaubt (Leerraum und Groß-/Kleinschreibung zählen nicht als Unterschied).
