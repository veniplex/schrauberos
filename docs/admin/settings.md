# Einstellungen

Die **Einstellungen** sind in Reiter gegliedert. Welche Reiter es gibt, hängt von den aktiven Funktionen ab: Jede Funktion bringt
ihre eigenen Einstellungen mit.

* **Werkstatt:** Name, Untertitel, Adresse, Logo, Akzentfarbe, **Zeitzone** (gilt sofort) und Öffnungszeiten.
* **Sicherheit:** „Die Anwendung läuft hinter einem Reverse-Proxy“. Nur wenn das eingeschaltet ist, wertet die Anmeldung die Adresse des
  Clients aus dem Header `X-Forwarded-For` aus und bremst Fehlversuche zusätzlich je Adresse (der Proxy muss die Client-Adresse als
  letzten Eintrag anhängen). Ohne Proxy bleibt die Option aus, weil sich der Header sonst fälschen ließe.
* **Backups:** Zeitplan der automatischen Backups (siehe Hilfe „Backups“).
* **Updates:** Zugang für die Update-Prüfung (siehe Hilfe „Updates“).
* **Termine** und **Reifenlager:** Kalender-Raster, Arbeitsplätze, Terminarten bzw. Ampel-Grenzwerte – beschrieben in der Hilfe
  der jeweiligen Funktion im Bereich Werkstatt. Den Reiter **Termine** sieht, wer das Recht „Arbeitsplätze, Terminarten und Kalender
  einrichten“ hat (auch ohne „Einstellungen verwalten“); er ist außerdem über die Schaltfläche im Terminkalender erreichbar.
* Das Recht „Werkstatt-Einstellungen verwalten“ gehört zu den Rechten der Verwaltung und wird nur von Administratoren vergeben.
