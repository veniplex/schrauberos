/** Kurzbeschreibung je Recht in der Rollenmaske (eine Zeile unter dem Namen): was die Person damit tun kann. `catalog.test.ts` verlangt eine für jedes Recht, in beiden Sprachen. */
export const permissionHintsDe = {
  appointments: {
    view: "Kalender und Termine ansehen, ohne etwas zu ändern.",
    create: "Neue Termine eintragen.",
    edit: "Termine ändern, verschieben und den Status setzen (Starten, Fertig).",
    delete: "Termine endgültig löschen.",
    configure: "Arbeitsplätze, Terminarten und das Zeitraster des Kalenders festlegen.",
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
  modules: {
    manage: "Module und Funktionen ein- und ausschalten.",
  },
};
