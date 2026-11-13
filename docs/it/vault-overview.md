# IT-Tresor: Überblick und Grenzen

Der **IT-Tresor** verwahrt Zugangsdaten zu IT-Systemen (Router, Server, Konten) verschlüsselt – getrennt von der IT-Dokumentation, in die keine Passwörter gehören. Dieses Kapitel erklärt, **wie man Zugriff bekommt** und **was der Tresor schützt und was nicht**; die Bedienung steht im Kapitel „IT-Tresor“, das nur sieht, wer das Recht dazu hat.

## Wie bekomme ich Zugriff?

* Der Tresor ist **nicht in den Standardrollen** und erscheint im Menü erst, wenn jemand das Recht **„Tresor ansehen“** hat. Zum Anlegen, Ändern und Löschen braucht man zusätzlich **„Tresor verwalten“**.
* Beide Rechte sind in der Rollenverwaltung als **„Nur ausdrücklich“** gekennzeichnet: **Auch Administratoren haben sie nicht von selbst.** Eine Administratorin oder ein Administrator legt dazu eine Rolle (zum Beispiel „Tresor“) mit diesen Rechten an und weist sie dem Konto zu (Verwaltung → Rollen & Rechte, Verwaltung → Benutzer).
* Jede Vergabe und jeder Entzug steht im **Audit-Log** (Rolle, Recht, Konto).

## Was der Tresor schützt – und was nicht

Der Tresor schützt vor **versehentlichem Ansehen** (Anzeige nur mit eigenem Passwort, begrenzt und protokolliert) und vor dem **Verlust von Datenbank oder Backup** (ohne die Tresor-Passphrase oder den Wiederherstellungsschlüssel unlesbar). Der Tresor-Schlüssel entsteht aus einer Passphrase und liegt nur im Speicher der Anwendung: **nach jedem Neustart ist der Tresor gesperrt**, bis eine berechtigte Person die Passphrase eingibt. Er schützt **nicht** vor einem Administrator, der die Anwendung vollständig kontrolliert:

* Wer den **Wiederherstellungsschlüssel besitzt** und **Backups** laden darf, kann den Tresor außerhalb der Anwendung lesen – ohne Tresor-Recht und ohne Anzeige-Eintrag im Audit-Log. Der Wiederherstellungsschlüssel (Verwaltung → Backups → Schlüssel) öffnet alles, auch den Tresor, und gehört getrennt vom Server in sichere Hände. Dasselbe gilt für die Tresor-Passphrase zusammen mit einem Backup.
* Ein Administrator kann sich die Tresor-Rechte selbst geben. Eine zweite Person, die zustimmen muss, gibt es nicht.
* Deshalb stehen diese Vorgänge, sobald es Tresor-Einträge gibt, mit dem Vermerk **„Tresor betroffen“** im Audit-Log, und Administratoren sehen einen Hinweis im Systemstatus. Wer das Audit-Log liest (Recht „Audit-Log einsehen“), sollte darauf achten.
* Titel, Art und System eines Eintrags stehen im Klartext in Liste, Sicherungen und Audit-Log – **keine Geheimnisse in den Titel**.

Zusammengefasst: Der Tresor ist ein sorgfältig geführtes Schloss, kein Safe gegen die eigene Administration. Wer volle Kontrolle über Server und Sicherungen hat, vertraut man ohnehin – der Tresor macht sie nur nachvollziehbar.
