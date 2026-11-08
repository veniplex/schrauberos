# E-Mail-Versand

Die Anwendung kann E-Mails **verschicken** – zum Beispiel eine Rechnung an einen Kunden. Eingehende Mails gibt es nicht, und es werden keine Erinnerungen oder Passwort-Rücksetzungen per Mail versandt. Solange der Versand nicht
eingerichtet und eingeschaltet ist, zeigt die Anwendung kein „Per E-Mail senden“; Herunterladen und Drucken gehen immer.

Eingerichtet wird er unter **Einstellungen → E-Mail** (nur Administratoren).

## Server eintragen

* **Server, Anschluss und Verschlüsselung:** Die Zugangsdaten bekommen Sie von Ihrem Mail-Anbieter. Üblich ist **STARTTLS mit Anschluss 587** oder **SMTPS mit Anschluss 465**. Die Anwendung prüft das **Zertifikat** des Servers immer; mit STARTTLS
  sendet sie nie unverschlüsselt, auch wenn der Server keine Verschlüsselung anbietet.
* **Benutzername und Passwort:** Das Passwort wird verschlüsselt gespeichert und nie wieder angezeigt. Ein leeres Feld behält das gespeicherte Passwort. Ändern Sie Server, Anschluss, Verschlüsselung oder Benutzernamen, tragen Sie das Passwort neu ein –
  ein gespeichertes Passwort geht nie an ein anderes Ziel.
* **Absender:** Absenderadresse (Pflicht), Absendername (erscheint vor der Adresse) und optional eine Antwortadresse.
* **Eigenes Netz:** Verbindungen zu Adressen im eigenen Netz (zum Beispiel ein interner Mail-Relay unter 192.168.x.x) sind aus Sicherheitsgründen gesperrt, solange Sie sie nicht ausdrücklich mit **„Server im eigenen Netz erlauben“** freigeben. Der eigene
  Server selbst (bei einem Betrieb im Container auch der Docker-Host) und Adressen für Cloud-Dienste sind nie erlaubt.
* **Unverschlüsselt** senden Sie nur, wenn Sie „Keine Verschlüsselung“ wählen, das Eigene-Netz-Häkchen setzen **und** die Warnung bestätigen – und nur zu einem Server im eigenen Netz. Zugangsdaten und Inhalte laufen dann im Klartext durchs Netz; das ist nur für
  einen vertrauenswürdigen internen Relay gedacht.

## Prüfen

Speichern Sie zuerst, dann:

* **Verbindung testen** baut die Verbindung auf und meldet sich an – gesendet wird nichts. Schlägt es fehl, nennt die Meldung den Grund (Server nicht erreichbar, Zertifikat nicht vertrauenswürdig, Anmeldung abgelehnt …), nie die Antwort des Servers.
* **Test-Mail an mich senden** schickt eine Nachricht an die **eigene** Adresse Ihres Kontos (unter **Benutzer** eintragen). Eine andere Adresse lässt sich nicht angeben.

## Versandlimits

Damit nichts außer Kontrolle gerät, gibt es Limits je Stunde und je Tag, **gesamt** und **je Benutzer** (Standard 60/300 gesamt, 20/100 je Benutzer). Es zählt alles, was angenommen wurde – auch wartende und fehlgeschlagene Nachrichten. 0 schaltet ein Limit aus.
Wer das Limit erreicht, bekommt eine Meldung und kann später noch einmal senden.

## Wer darf senden?

Das Recht **„E-Mails aus der Anwendung versenden“** (Kennzeichnung „Versand“) steckt in **keiner** Standardrolle; Sie vergeben es bewusst in der Rollenverwaltung. Jede Funktion, die Mails verschickt (zum Beispiel Rechnungen), verlangt zusätzlich ihr eigenes Recht.
Jede vorgemerkte Nachricht steht mit Empfänger und Betreff im **Audit-Log**.

## Sendeprotokoll und Fehler

Unter den Einstellungen steht das **Sendeprotokoll**: Zeitpunkt, Absender, Empfänger, Betreff, Status – **ohne Inhalt**. Es gehört zu den personenbezogenen Daten der Kunden: Bei einer Anonymisierung des Kunden werden Empfänger und Betreff der Zeilen zu seinen Belegen unkenntlich gemacht. Nachrichten werden im Hintergrund zugestellt: Klappt es nicht (Netz, Server nicht erreichbar, Anmeldung), versucht die Anwendung es mit
wachsenden Pausen bis zu zehnmal (rund drei Stunden); eine **endgültige** Absage des Servers (Empfänger unbekannt, Nachricht zu groß) wird nicht wiederholt. Danach steht die Nachricht als **Fehlgeschlagen** mit dem Grund im Protokoll, und im Systemstatus erscheint ein aufgegebenes
Ereignis. Nach der Behebung lässt sie sich dort mit **Erneut senden** noch einmal vormerken – solange ihr Inhalt noch da ist (30 Tage). Nimmt der Server nur einen Teil der Empfänger an, steht im Protokoll „n von m Empfängern zugestellt“; wiederholt wird (auch bei **Erneut senden**) nur für die übrigen, wer die Nachricht schon hat, bekommt sie nicht noch einmal. Gesendete Nachrichten behalten keinen Inhalt; Protokolleinträge werden nach einem Jahr gelöscht.

## Wiederherstellung und Sicherheit

* Das Passwort gehört zu den **Geheimnissen** der Anwendung: Es steckt nicht in Backups. Wird ein Backup ohne den passenden Geheimnisschlüssel eingespielt, entfernt die Anwendung das Passwort und **schaltet den Versand aus**; danach unter **Einstellungen → E-Mail**
  das Passwort neu eintragen und wieder einschalten (siehe **Backups**).
* In Kopfzeilen (Betreff, Absendername, Dateinamen von Anhängen) werden Zeilenumbrüche und Steuerzeichen entfernt, damit sich nichts einschleusen lässt.
