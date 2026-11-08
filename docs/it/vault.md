# IT-Tresor

Der IT-Tresor verwahrt **Zugangsdaten zu IT-Systemen** – Router, Server, Konten, Weboberflächen. Er ist das einzige Stück der Anwendung, in dem Passwörter stehen dürfen: Sie sind **verschlüsselt gespeichert** und erscheinen nur, wenn man sie ausdrücklich **anzeigt** und dazu das **eigene Passwort noch einmal eingibt**. Was der Tresor schützt – und was nicht –, steht im Kapitel „IT-Tresor: Überblick und Grenzen“.

## Wer darf was

Der Tresor hat zwei eigene Rechte, die man in der Rollenverwaltung vergibt. Beide sind als **„Nur ausdrücklich“** gekennzeichnet:

* **Tresor ansehen:** Einträge in der Liste sehen und Zugangsdaten anzeigen.
* **Tresor verwalten:** Einträge anlegen, ändern und löschen (zusammen mit „Tresor ansehen“).

**Administrator-Rollen haben alle Rechte – außer den ausdrücklich zu vergebenden.** Wer das System verwaltet, bekommt die Tresor-Rechte also nicht von selbst. Eine Person erhält sie nur über eine Rolle, die sie ausdrücklich enthält – zum Beispiel eine zusätzliche Rolle „Tresor“. Die Rechte stecken in keiner Standardrolle. **Ein Administrator kann sich die Rechte aber selbst geben** (eigene Rolle anlegen, dem eigenen Konto zuweisen); es gibt keine zweite Person, die zustimmen muss. Die Kontrolle ist das **Audit-Log**: Jede Vergabe und jeder Entzug steht dort mit Rolle und Recht (und bei der Zuweisung mit dem Konto) als eigener Eintrag.

## Einträge

Ein Eintrag besteht aus **Titel**, **Art** (Server, Netzwerkgerät, Konto/Dienst, Sonstiges) und einer **Systembezeichnung** (zum Beispiel „fw-01“). Diese drei stehen in der Liste **im Klartext** – auch in Sicherungen und im Audit-Log, in dem jede Anzeige mit dem Titel steht. **Schreiben Sie deshalb keine Passwörter oder Geheimnisse in den Titel.** Alles andere ist verschlüsselt und nur nach dem Anzeigen sichtbar:

* Adresse (URL)
* Benutzername
* Passwort bzw. Geheimnis
* Notiz

**Zugangsdaten gehören in die Felder des Tresors, nicht in die Dokumentation** (dort sind sie für alle lesbar, und alte Fassungen bleiben erhalten). Auch die Notiz ist verschlüsselt, aber für Hinweise gedacht („wofür ist das Konto?“); das Passwort gehört in sein eigenes Feld.

Beim Ändern eines Eintrags bleiben die Felder leer; ein leeres Feld lässt den bisherigen Wert stehen, mit „Entfernen“ löscht man ihn. **Wer die Zugangsdaten eines Eintrags ändert oder entfernt, gibt dazu das eigene Passwort ein** – ebenso beim **Löschen** (endgültig, mit Rückfrage). Umbenennen und das erste Eintragen von Zugangsdaten verlangen es nicht. Mehrere falsche Passwörter hintereinander bremsen die Eingabe aus – gemeinsam mit dem Anzeigen.

Titel, Art und System sind mit den verschlüsselten Angaben verbunden: Wer in der Datenbank Beschriftungen zwischen Einträgen vertauscht, bekommt keinen lesbaren Eintrag mehr. Eine Änderung daran verschlüsselt die Zugangsdaten deshalb neu – das geht nur, solange sie lesbar sind (siehe unten).

Der Browser soll die Felder nicht als Anmeldedaten dieser Anwendung ablegen: Das Passwortfeld des Tresors ist ein verdecktes Textfeld, nur die Bestätigung mit dem eigenen Passwort ist ein echtes Passwortfeld. Wenn Ihr Browser oder Passwortmanager trotzdem anbietet, einen Tresor-Eintrag zu speichern: ablehnen.

## Zugangsdaten anzeigen

Auf der Seite eines Eintrags: **Anzeigen**, das eigene Passwort eingeben, bestätigen. Die Werte erscheinen nur auf dieser Seite, mit **Kopieren**-Knöpfen, und **verschwinden nach 30 Sekunden** wieder (oder sofort mit „Ausblenden“). Zu beachten:

* Wer ein Passwort kopiert, hat es danach in der Zwischenablage, bis etwas anderes kopiert wird.
* Mehrere falsche Passwörter hintereinander bremsen die Eingabe aus (mit der Zeit länger); auch mit richtigem Passwort ist die Menge der Anzeigen begrenzt.
* **Jede Anzeige steht im Audit-Log** (wer, wann, welcher Eintrag mit Titel – nie der Inhalt), ebenso Anlegen, Ändern und Löschen. Ein Versuch mit falschem Passwort wird ebenfalls vermerkt – je Konto höchstens einmal pro Minute.
* Die Zugangsdaten tauchen **nirgends sonst** auf: nicht in der Suche, im Versionsverlauf der Dokumentation, im Export, in der Programmierschnittstelle oder in Webhooks.

## Sicherung und Wiederherstellung

Die Zugangsdaten liegen verschlüsselt in der Datenbank und damit **verschlüsselt in jedem Backup**. Der Schlüssel dazu (`secret.key`) liegt bewusst **nicht** im Backup. Deshalb gilt:

1. **Wiederherstellungsschlüssel anlegen und sichern** (Verwaltung → Backups → Schlüssel). Ohne ihn sind alle Tresor-Einträge unwiederbringlich verloren, wenn der Datenträger des Servers ausfällt und nur ein Backup bleibt. Solange er nicht gesichert ist, weist die Tresor-Seite darauf hin.
2. **Wiederherstellung mit dem Schlüssel:** Der Tresor ist danach wieder voll lesbar.
3. **Wiederherstellung ohne den Schlüssel:** Die Einträge bleiben mit Titel, Art und System erhalten, ihre Zugangsdaten sind aber nicht lesbar. Sie werden zurückgesetzt und der Eintrag zeigt **„Neu eingeben nötig“**. Vorher wird eine Sicherungsdatei der betroffenen verschlüsselten Zeilen im Datenverzeichnis abgelegt (Ordner `secret-reset`). Danach müssen die Zugangsdaten neu eingegeben werden. Zurückgesetzt wird nur, was ein fremder Schlüssel nicht öffnet – ein Eintrag in einem Format, das diese Programmversion nicht kennt (zum Beispiel nach dem Rückfall auf eine ältere Version), oder ein beschädigter Eintrag wird nie automatisch zurückgesetzt, sondern nur gemeldet.

Fehlt die Schlüsseldatei oder ist sie nicht lesbar, bleibt der Tresor **gesperrt**; es wird nichts gelöscht und nichts überschrieben. Solange der Geheimnisschlüssel nicht zur Datenbank passt (zum Beispiel nach einem Datenträgerwechsel, bevor der Schlüssel wiederhergestellt ist), lassen sich **keine Zugangsdaten anlegen oder ändern** – sie wären nach der Wiederherstellung des richtigen Schlüssels unlesbar. Ein vorhandener, aber nicht lesbarer Eintrag wird nie durch eine Teiländerung überschrieben: Ist er nicht zu retten (beschädigt oder zu keinem Schlüssel mehr gehörig), ersetzt ihn nur die vollständige Neueingabe aller vier Felder.

## Grenzen

Der Tresor schützt vor **versehentlichem Ansehen** und vor dem **Verlust von Datenbank oder Backup** (ohne den Schlüssel sind die Zugangsdaten unlesbar), und er macht jede Anzeige nachvollziehbar. Er schützt **nicht** vor einem Administrator, der die Anwendung vollständig kontrolliert:

* Wer den **Wiederherstellungsschlüssel erzeugt oder besitzt** und ein **Backup** laden darf (oder den Server selbst erreicht), kann den Tresor **außerhalb der Anwendung lesen** – ohne Tresor-Recht, ohne Passwortabfrage und ohne den Audit-Eintrag „Anzeige“. Der Wiederherstellungsschlüssel öffnet alles; er gehört deshalb wie ein Passwort **getrennt vom Server** in sichere Hände.
* Ein Administrator kann sich die Tresor-Rechte selbst geben und das Passwort eines Kontos mit Tresor-Recht neu setzen.
* Darum sind diese Vorgänge im Audit-Log **gekennzeichnet**: Gibt es Tresor-Einträge, steht bei „Wiederherstellungsschlüssel erzeugt“, beim Herunterladen und Wiederherstellen von Backups, beim Rekonstruieren des Schlüssels und bei jeder Vergabe der Tresor-Rechte der Vermerk **„Tresor betroffen“** (nur die Anzahl, nie Inhalte). Administratoren sehen den Hinweis außerdem im Systemstatus und unter Backups → Schlüssel.
* Wer ein Passwort angezeigt bekam, kann es weitergeben, und jede Person mit dem Recht „Tresor ansehen“ sieht **alle** Einträge – einzelne Einträge lassen sich nicht abschotten.
* Die Datenbankzeile eines Eintrags lässt sich als Ganzes durch einen älteren Stand ersetzen (zum Beispiel beim Zurückspielen eines alten Backups); der Tresor erkennt das nicht – ein früher geändertes Passwort kann so wieder auftauchen.

Das Recht sollte deshalb sparsam vergeben werden.
