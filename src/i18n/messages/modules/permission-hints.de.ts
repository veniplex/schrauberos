/** Kurzbeschreibung je Recht in der Rollenmaske (eine Zeile unter dem Namen): was die Person damit tun kann. `catalog.test.ts` verlangt eine für jedes Recht, in beiden Sprachen. */
export const permissionHintsDe = {
  appointments: {
    view: "Kalender und Termine ansehen, ohne etwas zu ändern.",
    create: "Neue Termine eintragen.",
    edit: "Termine ändern, verschieben und den Status setzen (Starten, Fertig).",
    delete: "Termine endgültig löschen.",
    configure: "Arbeitsplätze, Terminarten und das Zeitraster des Kalenders festlegen.",
  },
  orders: {
    view: "Werkstattaufträge mit Positionen (ohne Preise), Befunden und Verlauf ansehen.",
    create: "Aufträge annehmen, auch aus einem Termin.",
    edit: "Status setzen, Befunde und Positionen erfassen, Kundenfreigaben protokollieren.",
    close: "Aufträge abschließen („abgeholt“); dabei buchen andere Funktionen ab, z. B. das Lager.",
    reopen: "Einen abgeschlossenen Auftrag wieder öffnen: bucht zurück und steht im Audit-Log. Wird nie automatisch vergeben.",
    prices: "Preise, Steuersätze, Rabatte und Summen der Aufträge sehen und erfassen. Ohne dieses Recht bleiben sie verborgen (Standard für Mechaniker).",
  },
  parts: {
    view: "Artikel, Lagerbestand und Bewegungen ansehen (ohne Preise).",
    edit: "Artikel anlegen, ändern und archivieren.",
    stock: "Wareneingang erfassen und Inventur buchen.",
    prices: "Einkaufs- und Verkaufspreise der Artikel sehen und ändern. Ohne dieses Recht werden sie nicht gelesen (Standard für Mechaniker).",
  },
  tires: {
    view: "Reifensätze und ihren Lagerort ansehen.",
    create: "Neue Reifensätze einlagern.",
    edit: "Angaben zu Reifensätzen ändern und Sätze entsorgen.",
    stock: "Sätze ein- und ausbuchen (Lager, ausgelagert) – ohne sie sonst ändern zu können.",
    delete: "Reifensätze endgültig löschen.",
    export: "Alle Reifensätze als CSV-Datei herunterladen.",
    import: "Reifensätze aus einer CSV-Datei neu anlegen.",
  },
  customers: {
    view: "Kunden mit Adresse, Telefon und E-Mail ansehen.",
    edit: "Kunden anlegen und ändern.",
    delete: "Kunden löschen, soweit nichts mehr mit ihnen verknüpft ist.",
    disclose: "Alle zu einem Kunden gespeicherten Daten als Auskunft exportieren (CSV/JSON, mit Freitexten). Wird nie automatisch vergeben.",
    privacy: "Die Verarbeitung eines Kunden einschränken und seinen Stammsatz nach Ablauf der Aufbewahrungsfrist anonymisieren. Wird nie automatisch vergeben.",
    export: "Alle Kunden samt Kontaktdaten als CSV-Datei herunterladen (personenbezogene Daten).",
    import: "Kunden aus einer CSV-Datei neu anlegen.",
  },
  vehicles: {
    view: "Fahrzeuge, Prüffristen und Halter ansehen.",
    edit: "Fahrzeuge anlegen und ändern, Halterwechsel eintragen.",
    delete: "Fahrzeuge endgültig löschen.",
    export: "Fahrzeuge und Prüffristen als CSV-Datei herunterladen.",
    import: "Fahrzeuge aus einer CSV-Datei neu anlegen.",
  },
  network: {
    view: "Geräte, IP-Adressen, Verkabelung und Standorte ansehen.",
    edit: "Netzwerk-Einträge anlegen und ändern.",
    delete: "Netzwerk-Einträge löschen.",
  },
  invoices: {
    view: "Rechnungen und ihre Belege ansehen.",
    edit: "Rechnungen erfassen, ändern und als bezahlt markieren.",
    delete: "Rechnungen endgültig löschen (festgeschriebene nie).",
    finalize: "Ausgangsrechnungen festschreiben: danach unveränderlich und nicht löschbar, nicht umkehrbar. Wird nie automatisch vergeben.",
    export: "Rechnungen als CSV-Datei herunterladen, auch für den Steuerberater.",
    import: "Rechnungen aus einer CSV-Datei neu anlegen.",
  },
  employees: {
    view: "Mitarbeiter, Abwesenheiten (Krankheit nur als „abwesend“) und Qualifikationen ansehen.",
    edit: "Mitarbeiter, Abwesenheiten und Qualifikationen eintragen und ändern.",
    delete: "Mitarbeiter endgültig löschen.",
    sensitive: "Notfallkontakt und die Art von Abwesenheiten (Krankheit) sehen und ändern.",
  },
  files: {
    view: "Dokumente und Fotos an Fahrzeugen und Aufträgen ansehen – nur dort, wo die Person auch das Fahrzeug bzw. den Auftrag sehen darf.",
    upload: "Fotos (JPEG, PNG) und PDF-Dokumente hochladen und beschriften. Standortdaten werden aus Fotos entfernt.",
    delete: "Dateien aller Personen entfernen (Leitung). Wer hochladen darf, entfernt auch seine eigenen Dateien.",
  },
  time: {
    view: "Die eigenen Zeiten ansehen: Stempel, Einträge, Wochenübersicht mit Ist, Soll und Saldo.",
    stamp: "Kommen und Gehen stempeln, einen Auftrag starten und beenden.",
    correct: "Eigene Zeiten korrigieren, stornieren oder nachtragen – immer mit Begründung im Korrekturverlauf.",
    viewAll: "Zeiten aller Mitarbeiter ansehen (Team-Übersicht). Personenbezogen, wird nie automatisch vergeben.",
    correctAll: "Zeiten aller Mitarbeiter korrigieren, stornieren und nachtragen (zusätzlich zu „korrigieren“). Wird nie automatisch vergeben.",
  },
  fleet: {
    view: "Firmenfahrzeuge, Fristen und Kosten ansehen.",
    edit: "Firmenfahrzeuge, Fristen und Kosten eintragen und ändern.",
    delete: "Fuhrpark-Einträge löschen.",
  },
  handbook: {
    view: "Kapitel und Seiten des Handbuchs lesen (soweit die Kapitel für die Rolle freigegeben sind).",
    edit: "Handbuchseiten und Kapitel schreiben und ändern.",
  },
  docsIt: {
    view: "Die IT-Dokumentation lesen.",
    edit: "IT-Dokumentation schreiben und ändern.",
  },
  users: {
    view: "Die Benutzerliste ansehen.",
    manage: "Benutzer anlegen, ändern, sperren und ihre Rollen setzen.",
  },
  roles: {
    manage: "Rollen anlegen, ändern und löschen – nur Rechte, die man selbst hat.",
  },
  settings: {
    manage: "Werkstattprofil, Öffnungszeiten, Sicherheit und die Einstellungen der Funktionen ändern.",
  },
  audit: {
    view: "Das Audit-Log lesen: wer wann was geändert hat.",
  },
  updates: {
    manage: "Updates der Anwendung installieren und zurückrollen.",
  },
  system: {
    view: "Systemstatus (Plattenplatz, Version, Jobs, Protokoll) ansehen.",
  },
  backup: {
    manage: "Backups anlegen, herunterladen und wiederherstellen, Off-Site-Sicherung einrichten.",
    keys: "Den Wiederherstellungsschlüssel erzeugen und bestätigen.",
  },
  mail: {
    manage: "Den Mailserver einrichten, testen und das Sendeprotokoll ansehen.",
    send: "E-Mails aus der Anwendung versenden (z. B. eine Rechnung an einen Kunden). Wird nie automatisch vergeben.",
  },
  modules: {
    manage: "Module und Funktionen ein- und ausschalten.",
  },
};
