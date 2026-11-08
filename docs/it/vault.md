# IT-Tresor

Der IT-Tresor verwahrt **Zugangsdaten zu IT-Systemen** – Router, Server, Konten, Weboberflächen. Er ist das einzige Stück der Anwendung, in dem Passwörter stehen dürfen: Sie sind **verschlüsselt gespeichert** und erscheinen nur, wenn man sie ausdrücklich **anzeigt** und dazu das **eigene Passwort noch einmal eingibt**.

## Wer darf was

Der Tresor hat zwei eigene Rechte, die man in der Rollenverwaltung vergibt. Beide sind als **„Nur ausdrücklich“** gekennzeichnet:

* **Tresor ansehen:** Einträge in der Liste sehen und Zugangsdaten anzeigen.
* **Tresor verwalten:** Einträge anlegen, ändern und löschen (zusammen mit „Tresor ansehen“).

**Auch Administratoren haben diese Rechte nicht von selbst.** Wer das System verwaltet, soll nicht schon deshalb Zugangsdaten sehen. Eine Person bekommt sie nur über eine Rolle, die sie ausdrücklich enthält – zum Beispiel eine zusätzliche Rolle „Tresor“. Die Rechte stecken in keiner Standardrolle, und die Vergabe ist im Audit-Log nachzulesen.

## Einträge

Ein Eintrag besteht aus **Titel**, **Art** (Server, Netzwerkgerät, Konto/Dienst, Sonstiges) und einer **Systembezeichnung** (zum Beispiel „fw-01“). Diese drei stehen in der Liste im Klartext, damit man den Eintrag findet. Alles andere ist verschlüsselt und nur nach dem Anzeigen sichtbar:

* Adresse (URL)
* Benutzername
* Passwort bzw. Geheimnis
* Notiz

**Keine Passwörter im Klartext in Notizen oder in der Dokumentation:** Zugangsdaten gehören in diese Felder. Eine Notiz ist für Hinweise gedacht („wofür ist das Konto?“), nicht für Passwörter. Beim Ändern eines Eintrags bleiben die Felder leer; ein leeres Feld lässt den bisherigen Wert stehen, mit „Entfernen“ löscht man ihn. Löschen ist endgültig.

## Zugangsdaten anzeigen

Auf der Seite eines Eintrags: **Anzeigen**, das eigene Passwort eingeben, bestätigen. Die Werte erscheinen nur auf dieser Seite, mit **Kopieren**-Knöpfen, und **verschwinden nach 30 Sekunden** wieder (oder sofort mit „Ausblenden“). Zu beachten:

* Wer ein Passwort kopiert, hat es danach in der Zwischenablage, bis etwas anderes kopiert wird.
* Mehrere falsche Passwörter hintereinander bremsen die Eingabe aus (mit der Zeit länger); auch mit richtigem Passwort ist die Menge der Anzeigen begrenzt.
* **Jede Anzeige steht im Audit-Log** (wer, wann, welcher Eintrag – nie der Inhalt), ebenso Anlegen, Ändern und Löschen. Ein Versuch mit falschem Passwort wird ebenfalls vermerkt.
* Die Zugangsdaten tauchen **nirgends sonst** auf: nicht in der Suche, im Versionsverlauf der Dokumentation, im Export, in der Programmierschnittstelle oder in Webhooks.

## Sicherung und Wiederherstellung

Die Zugangsdaten liegen verschlüsselt in der Datenbank und damit **verschlüsselt in jedem Backup**. Der Schlüssel dazu (`secret.key`) liegt bewusst **nicht** im Backup. Deshalb gilt:

1. **Wiederherstellungsschlüssel anlegen und sichern** (Verwaltung → Backups → Schlüssel). Ohne ihn sind alle Tresor-Einträge unwiederbringlich verloren, wenn der Datenträger des Servers ausfällt und nur ein Backup bleibt. Solange er nicht gesichert ist, weist die Tresor-Seite darauf hin.
2. **Wiederherstellung mit dem Schlüssel:** Der Tresor ist danach wieder voll lesbar.
3. **Wiederherstellung ohne den Schlüssel:** Die Einträge bleiben mit Titel, Art und System erhalten, ihre Zugangsdaten sind aber nicht lesbar. Sie werden zurückgesetzt und der Eintrag zeigt **„Neu eingeben nötig“**. Vorher wird eine Sicherungsdatei der betroffenen verschlüsselten Zeilen im Datenverzeichnis abgelegt (Ordner `secret-reset`). Danach müssen die Zugangsdaten neu eingegeben werden.

Fehlt die Schlüsseldatei oder ist sie nicht lesbar, bleibt der Tresor **gesperrt**; es wird nichts gelöscht und nichts überschrieben.

## Grenzen

Der Tresor schützt vor dem Mitlesen in der Datenbank, in Backups und in Berichten – nicht davor, dass jemand mit dem Recht und dem eigenen Passwort die Werte anzeigt und weitergibt. Das Recht sollte deshalb sparsam vergeben werden.
