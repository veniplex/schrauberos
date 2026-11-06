# Audit-Log

Das **Audit-Log** zeigt, wer wann was getan hat: Anmeldungen (auch fehlgeschlagene und gedrosselte; bei Dauerbeschuss nur gedrosselt, unbekannte Namen nur als Kürzel), Passwort- und Profiländerungen, Änderungen an
Benutzern, Rollen, Modulen und Einstellungen (auch Backup-Plan und Update-Token – das Token selbst steht nie im Log), Backups
(auch fehlgeschlagene Anlegen, Wiederherstellungen und Importe), Updates, das Anlegen und Ändern von Kunden, Fahrzeugen und Rechnungen
(auch „als bezahlt markiert“ und „wieder geöffnet“) sowie Löschungen von Kunden, Fahrzeugen, Reifensätzen, Terminen,
Rechnungen, Mitarbeitern, Fuhrpark-Einträgen, Netzwerk-Geräten und Seiten in Handbuch und IT-Dokumentation. Jeder Eintrag entsteht
gemeinsam mit der Änderung selbst – gibt es den Eintrag nicht, gab es auch die Änderung nicht.

**Aufbewahrung:** Einträge, die älter sind als die eingestellte Frist, werden täglich gelöscht (Datensparsamkeit). Standard sind 730 Tage (2 Jahre);
einstellen lässt sich das unter Einstellungen → Sicherheit, `0` bewahrt alles auf. Die Löschung steht selbst als Eintrag „Alte Audit-Einträge gelöscht“ im Log.

Die Liste lässt sich nach Benutzer oder Objekt durchsuchen und nach Aktionsgruppe filtern. Der Name der handelnden Person bleibt
auch erhalten, wenn das Konto später gelöscht wird.
