# Systemstatus

Der **Systemstatus** zeigt, was die Anwendung im Hintergrund erledigt – ohne dass jemand etwas anstoßen muss. Die Seite ist nur für Administratoren.

* **Geplante Jobs:** das automatische Backup, das Aufräumen alter Backups, des Audit-Logs und der API-Daten sowie die Zustellung von Ereignissen
  (zum Beispiel für E-Mail oder Schnittstellen). Zu jedem Job steht, **wann er zuletzt lief, ob es geklappt hat** (OK, Fehler, Unterbrochen), **was dabei herauskam**,
  **wann er wieder dran ist** und wie viele Fehlversuche in Folge es gab. Zeitpläne mit Uhrzeit gelten in der **Zeitzone der Werkstatt**
  (Einstellungen → Werkstatt), auch an den Tagen der Sommerzeit-Umstellung.
* **Fehler werden wiederholt:** Schlägt ein Job fehl, versucht die Anwendung es automatisch wieder – mit wachsender Wartezeit, nicht erst am nächsten Tag.
  Solange er nicht gelingt, steht der Fehler hier (und beim automatischen Backup zusätzlich auf der Seite „Backups“). Die Meldung nennt nur die Art des Fehlers,
  keine Daten. Meist hilft es, den freien Speicherplatz auf dem Server zu prüfen.
* **Nach einem Neustart** macht die Anwendung unterbrochene Jobs von selbst weiter („Unterbrochen“ erscheint dann einmal in der Liste der Läufe).
* **Ruht eine Funktion** (weil sie ausgeschaltet ist), ruhen auch ihre Jobs; beim Wiedereinschalten werden sie nachgeholt.
* **Ereignisse (Outbox):** Wartende Ereignisse werden zugestellt; schlägt die Zustellung wiederholt fehl, wird das Ereignis aufgegeben und unter „Aufgegeben“ gezählt.
* **Letzte Läufe:** die jüngsten Ergebnisse aller Jobs. Sie werden 30 Tage aufbewahrt.
