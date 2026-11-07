# Einstellungen

Die **Einstellungen** sind in Reiter gegliedert. Welche Reiter es gibt, hängt von den aktiven Funktionen ab: Jede Funktion bringt
ihre eigenen Einstellungen mit.

* **Werkstatt:** Name, Untertitel, Adresse, Logo, Akzentfarbe (eine frei gewählte Farbe, die als Schrift zu blass wäre, wird mit einem Hinweis markiert), **Zeitzone** (gilt sofort) und Öffnungszeiten.
* **Sicherheit:** „Die Anwendung läuft hinter einem Reverse-Proxy“. Nur wenn das eingeschaltet ist, wertet die Anmeldung die Adresse des
  Clients aus dem Header `X-Forwarded-For` aus und bremst Fehlversuche zusätzlich je Adresse. **Nur einschalten, wenn wirklich ein
  Reverse-Proxy davorsteht**, der die Client-Adresse als letzten Eintrag anhängt (nginx: `proxy_add_x_forwarded_for`). Ohne echten Proxy
  kann jeder die Adresse im Header beliebig vortäuschen und damit fremde Adressen sperren lassen. Auch mit Proxy gilt: Teilen sich
  viele Geräte eine Adresse (Büro-Netz hinter NAT), trifft die Begrenzung je Adresse alle gemeinsam – auch Administratoren, außer auf
  Geräten, mit denen sie sich schon einmal angemeldet haben. Im Zweifel bleibt die Option aus. Mit der Einstellung gilt für den Herkunftsvergleich beim
  **Hochladen** (Backups, Bilder in der Dokumentation) außerdem der Header `X-Forwarded-Host`: Schreibt der Proxy den `Host` um, muss er den öffentlichen
  Namen dort mitgeben (nginx: `proxy_set_header X-Forwarded-Host $host;`), sonst werden Uploads mit „Verboten“ abgewiesen. Außerdem: **Audit-Log aufbewahren (Tage)** –
  ältere Einträge werden täglich gelöscht, Standard 730 Tage, mindestens 30; `0` = unbegrenzt (siehe Hilfe „Audit-Log“).
* **Backups:** Zeitplan der automatischen Backups und die Aufbewahrung je Art von Backup (siehe Hilfe „Backups“).
* **Updates:** Zugang für die Update-Prüfung (siehe Hilfe „Updates“).
* **Termine** und **Reifenlager:** Kalender-Raster, Arbeitsplätze, Terminarten bzw. Ampel-Grenzwerte und Winterfenster – beschrieben in der Hilfe
  der jeweiligen Funktion im Bereich Werkstatt. Den Reiter **Termine** sieht, wer das Recht „Arbeitsplätze, Terminarten und Kalender
  einrichten“ hat (auch ohne „Einstellungen verwalten“); er ist außerdem über die Schaltfläche im Terminkalender erreichbar.
* Das Recht „Werkstatt-Einstellungen verwalten“ gehört zu den Rechten der Verwaltung und wird nur von Administratoren vergeben.
