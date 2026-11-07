# Einstellungen

> **Einrichtungs-Checkliste:** Auf der **Übersicht** zeigt sich Administratoren eine Karte „Einrichtung“ mit den Schritten, die für einen sicheren Betrieb noch offen sind: Werkstattprofil und Öffnungszeiten, Arbeitsplätze
> und Terminarten, Wiederherstellungs-Code und Wiederherstellungsschlüssel gesichert, automatisches Backup und Off-Site-Sicherung, ersten Mitarbeiter und weitere Benutzer anlegen, HTTPS und Zwei-Faktor-Anmeldung. Jede
> Funktion bringt ihre Schritte selbst mit – ausgeschaltete Funktionen fragt die Checkliste nicht ab. Die Punkte **haken sich von selbst ab**, sobald der Datenstand es hergibt (nichts wird von Hand bestätigt); „empfohlen“
> markiert Punkte, die sich ruhiger anmahnen. **Checkliste ausblenden** (oder, wenn alles erledigt ist, **Fertig – Checkliste ausblenden**) blendet die Karte für die ganze Werkstatt aus und steht im Audit-Log; unten auf der Übersicht
> bringt **Einrichtungs-Checkliste wieder einblenden** sie zurück.

Die **Einstellungen** sind in Reiter gegliedert. Welche Reiter es gibt, hängt von den aktiven Funktionen ab: Jede Funktion bringt
ihre eigenen Einstellungen mit.

* **Werkstatt:** Name, Untertitel, Adresse, Logo (PNG, JPEG oder WebP, höchstens 200 KB; es erscheint in Kopfzeile und Anmeldeseite, ein SVG-Logo wird aus Sicherheitsgründen nicht angenommen), Akzentfarbe (eine frei gewählte Farbe, die als Schrift zu blass wäre, wird mit einem Hinweis markiert), **Zeitzone** (gilt sofort) und Öffnungszeiten. Alle Tage und Uhrzeiten der Anwendung – Termine und Kalender, Öffnungszeiten, Fristen, Rechnungsdaten, Abwesenheiten, die Saison im Reifenlager und die Uhrzeit der nächtlichen Sicherung – gelten in dieser Zeitzone, unabhängig von der Einstellung des Servers.
* **Feiertage:** Wählen Sie **Land und Bundesland bzw. Kanton** (Deutschland: alle 16 Länder, Österreich: Bundesländer, Schweiz: Kantone). Die gesetzlichen Feiertage werden daraus **berechnet** – Ostern und alle davon abhängigen Tage für jedes Jahr, es gibt keine feste Liste, die ausläuft. Darunter stehen die Tage des laufenden Jahres: Sie können einen Tag **streichen**, zum **halben Tag** machen (zählt dann als halber Arbeitstag) oder – bei den Landesfeiertagen Österreichs, die nicht gesetzlich arbeitsfrei sind und deshalb nur als Vorschlag erscheinen – **einschalten**. Mit **Eigene Tage** ergänzen Sie Betriebsferien, Brückentage oder Heiligabend als halben Tag, einmalig oder jedes Jahr am selben Datum. Wer die Region wechselt, beginnt bei den gesetzlichen Tagen mit den Vorgaben der neuen Region (eigene Tage bleiben). Die Feiertage fließen in die **Arbeitstage der Abwesenheiten** (Verwaltung → Mitarbeiter) und in die **Hinweise im Terminformular** ein. Ohne gewählte Region werden keine Feiertage berücksichtigt. Hinweis: Gemeinde- und Konfessionsfeiertage (z. B. Mariä Himmelfahrt in Bayern, nur in Teilen des Landes) sind als solche markiert; die Regeln folgen den üblichen Zusammenstellungen – prüfen Sie Ihre Region und passen Sie sie bei Bedarf an. Änderungen stehen im Audit-Log („Feiertage geändert“).
* **Sicherheit – Sitzungen:** **Abmelden nach Leerlauf (Stunden)**: Sitzungen enden, wenn so lange keine Seite aufgerufen wurde (auf etwa eine Minute genau; 0 = aus, Standard; höchstens 720). Wer sich dann
  neu anmeldet, landet auf derselben Seite, und nicht gespeicherte Eingaben bleiben im Browser erhalten. **Zwei-Faktor-Anmeldung für Administratoren verpflichtend** (Standard: aus): Administrator-Konten ohne
  eingerichteten zweiten Faktor erreichen dann nach der Anmeldung nur „Mein Konto“ und können ihn nicht ausschalten. Vorher sicherstellen, dass jeder Administrator ein Handy mit Authenticator-App hat; ein
  Administrator, der sein Handy verliert, wird von einem anderen Administrator zurückgesetzt (Verwaltung → Benutzer) oder nutzt den Wiederherstellungs-Code. Beide Einstellungen stehen im Audit-Log.
* **Sicherheit:** „Die Anwendung läuft hinter einem Reverse-Proxy“. Nur wenn das eingeschaltet ist, wertet die Anmeldung die Adresse des
  Clients aus dem Header `X-Forwarded-For` aus und bremst Fehlversuche zusätzlich je Adresse. **Nur einschalten, wenn wirklich ein
  Reverse-Proxy davorsteht**, der die Client-Adresse als letzten Eintrag anhängt (nginx: `proxy_add_x_forwarded_for`). Ohne echten Proxy
  kann jeder die Adresse im Header beliebig vortäuschen und damit fremde Adressen sperren lassen. Auch mit Proxy gilt: Teilen sich
  viele Geräte eine Adresse (Büro-Netz hinter NAT), trifft die Begrenzung je Adresse alle gemeinsam – auch Administratoren, außer auf
  Geräten, mit denen sie sich schon einmal angemeldet haben. Im Zweifel bleibt die Option aus. Mit der Einstellung gilt für den Herkunftsvergleich beim
  **Hochladen** (Backups, Bilder in der Dokumentation) außerdem der Header `X-Forwarded-Host`: Schreibt der Proxy den `Host` um, muss er den öffentlichen
  Namen dort mitgeben (nginx: `proxy_set_header X-Forwarded-Host $host;`), sonst werden Uploads mit „Verboten“ abgewiesen. Außerdem: **Audit-Log aufbewahren (Tage)** –
  ältere Einträge werden täglich gelöscht, Standard 730 Tage, mindestens 30; `0` = unbegrenzt (siehe Hilfe „Audit-Log“).
  Dazu zeigt der Reiter, ob die Seite **verschlüsselt (HTTPS)** geöffnet wurde: Bei HTTP erscheint ein Hinweis (im Werkstattnetz in Ordnung, für den Zugriff von außen nicht); bei HTTPS
  weist die Anwendung den Browser an, die Adresse künftig nur noch verschlüsselt aufzurufen. Steht „Hinter Reverse-Proxy“ an, die Anfrage kommt aber als HTTP an, sagt der Hinweis, dass der Proxy
  `X-Forwarded-Proto: https` weitergeben muss. **Nur über HTTPS** lässt sich die Anwendung auf Handy und Tablet installieren und zeigt ohne Verbindung die Seite „Keine Verbindung“ (siehe Hilfe „Auf dem Handy installieren“).
  **Inhaltssicherheitsrichtlinie (CSP):** Die Anwendung erlaubt dem Browser nur Skripte und Inhalte, die sie selbst ausliefert. Zeigt eine Seite deswegen einmal nichts mehr an, kann ein
  Administrator die Richtlinie hier vorübergehend auf **„nur melden“** stellen: Der Browser blockiert dann nichts mehr und schreibt Verstöße nur in seine Konsole (Notbetrieb, gilt sofort für alle,
  steht im Audit-Log). Danach bitte wieder erzwingen lassen.
* **Backups:** Zeitplan der automatischen Backups und die Aufbewahrung je Art von Backup (siehe Hilfe „Backups“).
* **Updates:** Zugang für die Update-Prüfung (siehe Hilfe „Updates“).
* **Termine** und **Reifenlager:** Kalender-Raster, Arbeitsplätze, Terminarten bzw. Ampel-Grenzwerte und Winterfenster – beschrieben in der Hilfe
  der jeweiligen Funktion im Bereich Werkstatt. Den Reiter **Termine** sieht, wer das Recht „Arbeitsplätze, Terminarten und Kalender
  einrichten“ hat (auch ohne „Einstellungen verwalten“); er ist außerdem über die Schaltfläche im Terminkalender erreichbar.
* Das Recht „Werkstatt-Einstellungen verwalten“ gehört zu den Rechten der Verwaltung und wird nur von Administratoren vergeben.
