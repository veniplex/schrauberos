# Rollen und Rechte

Eine **Rolle** bündelt Rechte; ein Benutzer kann mehrere Rollen haben, die Rechte addieren sich. Unter **Rollen & Rechte** sind die
Rechte nach Bereich und Funktion gegliedert (ansehen, anlegen, bearbeiten, löschen …). Mitgeliefert sind Administrator,
Geschäftsführung, Büro / Verwaltung, Serviceberater, Mechaniker, Lager und IT-Administrator – sie lassen sich anpassen.

* **Administrator-Rollen** haben alle Rechte, auch für künftige Funktionen – **außer den ausdrücklich zu vergebenden** (Kennzeichnung „Nur ausdrücklich“, zurzeit „Tresor ansehen“ und „Tresor verwalten“ des IT-Tresors). Die bekommt auch ein Administrator nur über eine Rolle, die sie enthält; er kann sie sich aber selbst geben – jede Vergabe und jeder Entzug steht im Audit-Log (Rolle, Recht, Konto), bei vorhandenen Tresor-Einträgen mit dem Vermerk „Tresor betroffen“. Deshalb steht in der Rollenliste bei Administrator-Rollen „alle Rechte, außer den ausdrücklich zu vergebenden“. Wird ein Administrator auf einer Seite abgewiesen (zum Beispiel im IT-Tresor), nennt die Sperrseite diesen Grund und führt zu den Rollen: Dort legen Sie eine Rolle an, die „Tresor ansehen“ (und bei Bedarf „Tresor verwalten“) ausdrücklich enthält, und weisen sie dem Konto zu.
* **Die Maske ist für viele Rechte gebaut:** Jedes Recht trägt eine **Kurzbeschreibung** (was die Person damit tun kann) und, wo nötig, eine Kennzeichnung – „Nur Administratoren“,
  „Nur ausdrücklich“, „Sensibel“, „Export“, „Import“. Die Rechte sind in **einklappbaren Gruppen** nach Funktion geordnet; offen sind die Gruppen, in denen die Rolle schon Rechte hat
  (**Alle aufklappen** / **Alle zuklappen** öffnen oder schließen alles). Die **Suche** über der Liste findet Rechte nach Name, Beschreibung und Kennzeichnung („Export“, „Rechnung“, „löschen“) und blendet
  alles andere aus – abgewählt wird dadurch nichts, gespeichert wird immer die ganze Auswahl.
* **Rollenvorlagen:** „Mechaniker“, „Büro“ und „Leitung“ füllen die Auswahl vor und ersetzen die bisherige; erst **Speichern** übernimmt sie. Name und Beschreibung werden nur gefüllt, wenn sie noch leer sind.
  Keine Vorlage enthält Rechte der Verwaltung, sensible Mitarbeiterdaten, Export oder Import – die vergeben Sie bewusst einzeln.
* **Was sieht diese Rolle?** Rechts neben der Auswahl (auf schmalen Bildschirmen darunter) zeigt eine Vorschau, welche Navigationseinträge, Übersichts-Bausteine und Schnellaktionen („Neu“) die gewählten Rechte
  freischalten – berechnet aus den Rechten und den eingeschalteten Funktionen, sie ändert sich mit jedem Häkchen. Einträge ausgeschalteter Funktionen sind nicht dabei, die Vorschau zählt sie aber als „erscheinen, sobald die Funktion eingeschaltet wird“.
* Rechte **ausgeschalteter Funktionen** stehen je Bereich eingeklappt unter „Ausgeschaltete Funktionen“ mit einem Hinweis, statt als lange Liste; sie wirken erst nach dem Wiedereinschalten.
* **Rechte der Verwaltung** („Benutzer verwalten“, „Rollen & Rechte verwalten“, „Werkstatt-Einstellungen verwalten“, „Module und
  Funktionen ein-/ausschalten“, „Backups verwalten und wiederherstellen“, „Updates installieren“, „Systemstatus und geplante Jobs einsehen“) sind faktisch Administratorrechte. Sie vergeben **nur Administratoren**; die Standardrollen
  enthalten sie nicht. Rollen, die sie enthalten, kennzeichnet die Liste mit „Verwaltungsrechte“.
* **Wer Rollen ändern darf:** Ein Konto ohne Administrator-Rolle, dem ein Administrator „Rollen verwalten“ gegeben hat, kann nur
  Rechte hinzufügen oder entfernen, die es selbst besitzt, und keine Verwaltungsrechte. Die eigene Rolle, Administrator-Rollen und Rollen
  mit Verwaltungsrechten bleiben Administratoren vorbehalten. Gesperrte Rechte sind ausgegraut; bereits vorhandene bleiben erhalten.
* **Bearbeiten setzt Ansehen:** Wer in der Maske ein Recht wie „bearbeiten“ wählt, bekommt „ansehen“ derselben Funktion dazu; wird
  „ansehen“ abgewählt, entfallen die übrigen Rechte der Funktion.
* **Rolle duplizieren** legt eine neue Rolle mit denselben Rechten an – praktisch als Ausgangspunkt für eine abgewandelte Rolle.
* **Gleichzeitiges Bearbeiten:** Hat jemand die Rolle inzwischen geändert, meldet das Speichern einen Konflikt, statt still zu überschreiben.
