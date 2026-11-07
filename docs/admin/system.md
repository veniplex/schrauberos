# Systemstatus

Der **Systemstatus** zeigt, was die Anwendung im Hintergrund erledigt – ohne dass jemand etwas anstoßen muss. Die Seite ist nur für Administratoren.

* **Geplante Aufgaben:** das automatische Backup, das Aufräumen alter Backups, des Audit-Logs und der API-Daten sowie die Zustellung von Ereignissen
  (zum Beispiel für E-Mail oder Schnittstellen). Zu jeder Aufgabe steht, **wann sie zuletzt lief, ob es geklappt hat** (OK, Fehler, Unterbrochen), **was dabei herauskam**,
  **wann sie wieder dran ist** und wie viele Fehlversuche in Folge es gab. Zeitpläne mit Uhrzeit gelten in der **Zeitzone der Werkstatt**
  (Einstellungen → Werkstatt), auch an den Tagen der Sommerzeit-Umstellung.
* **Fehler werden wiederholt:** Schlägt eine Aufgabe fehl, versucht die Anwendung es automatisch wieder – mit wachsender Wartezeit, nicht erst am nächsten Tag.
  Solange er nicht gelingt, steht der Fehler hier (und beim automatischen Backup zusätzlich auf der Seite „Backups“). Die Meldung nennt nur die Art des Fehlers,
  keine Daten. Meist hilft es, den freien Speicherplatz auf dem Server zu prüfen.
* **Was „alles in Ordnung“ heißt:** keine Aufgabe ist in einer Fehlerserie, überfällig oder hängt, es gibt keine aufgegebenen Ereignisse, und der **Zeitgeber** (er stößt die Aufgaben an) hat sich in den
  letzten Minuten gemeldet – unter der Meldung steht, wann zuletzt. Andernfalls nennt die Seite jede Auffälligkeit einzeln. Aufgaben von ausgeschalteten Funktionen zählen nicht.
* **Letzte Läufe:** Die Liste zeigt nur Auffälliges – Fehler, Unterbrechungen und Läufe mit einer Meldung (zum Beispiel „3 gelöscht“). Ein Lauf ohne Besonderheiten steht nicht darin; sein Ergebnis steht in der Tabelle der Aufgaben oben.
* **Nach einem Neustart** macht die Anwendung unterbrochene Aufgaben von selbst weiter („Unterbrochen“ erscheint dann einmal in der Liste der Läufe).
* **Ruht eine Funktion** (weil sie ausgeschaltet ist), ruhen auch ihre Aufgaben; beim Wiedereinschalten werden sie nachgeholt.
* **Ereignisse (Warteschlange):** Wartende Ereignisse werden zugestellt; schlägt die Zustellung wiederholt fehl, wird das Ereignis aufgegeben und unter „Aufgegeben“ gezählt. Ist die Funktion
  eines Empfängers ausgeschaltet, bleiben die Ereignisse für ihn bis zu 14 Tage offen und werden beim Einschalten nachgeholt. Reagiert ein Empfänger nicht, gilt die Zustellung nach 30 Sekunden als gescheitert und wird später wiederholt.
* Die Läufe werden 30 Tage aufbewahrt.
