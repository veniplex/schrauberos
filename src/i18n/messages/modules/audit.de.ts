export const auditDe = {
  feature: {
    name: "Audit-Log",
    description: "Protokoll sicherheits- und verwaltungsrelevanter Aktionen: wer hat wann was getan.",
  },
  title: "Audit-Log",
  description: "Wer hat wann was getan? Anmeldungen, Änderungen an Benutzern, Rollen und Einstellungen sowie Löschungen.",
  cols: { time: "Zeitpunkt", actor: "Benutzer", action: "Aktion", target: "Betroffen" },
  searchPlaceholder: "Benutzer oder Objekt …",
  allActions: "Alle Aktionen",
  empty: "Keine Einträge gefunden.",
  count_one: "{count} Eintrag",
  count_other: "{count} Einträge",
  page: "Seite {page} von {pages}",
  groups: {
    backup: "Backups",
    setup: "Einrichtung",
    system: "System",
    auth: "Anmeldung",
    account: "Konto",
    user: "Benutzer",
    role: "Rollen",
    module: "Module & Funktionen",
    settings: "Einstellungen",
    appointment: "Termine",
    customer: "Kunden",
    vehicle: "Fahrzeuge",
    tires: "Reifenlager",
    invoice: "Rechnungen",
    employee: "Mitarbeiter",
    fleet: "Fuhrpark",
    network: "Netzwerk",
    docs: "Dokumentation",
  },
  actions: {
    backup: {
      create: "Backup erstellt",
      delete: "Backup gelöscht",
      download: "Backup heruntergeladen",
      restore: "Backup wiederhergestellt",
      upload: "Backup hochgeladen",
    },
    setup: {
      complete: "Ersteinrichtung abgeschlossen",
    },
    system: {
      update: "Update installiert",
      updateFailed: "Update fehlgeschlagen",
    },
    auth: {
      login: "Angemeldet",
      loginFailed: "Anmeldung fehlgeschlagen",
      loginThrottled: "Anmeldung gedrosselt (zu viele Fehlversuche)",
      recoveryCreated: "Wiederherstellungs-Code erzeugt",
      recoveryUsed: "Notzugang verwendet (Wiederherstellungs-Code eingelöst)",
      recoveryFailed: "Notzugang: Einlösen fehlgeschlagen",
      logout: "Abgemeldet",
    },
    account: {
      password: "Passwort geändert",
      profile: "Profil geändert",
    },
    user: {
      create: "Benutzer angelegt",
      update: "Benutzer geändert",
      delete: "Benutzer gelöscht",
      unlock: "Anmeldesperre aufgehoben",
    },
    role: {
      create: "Rolle angelegt",
      update: "Rolle geändert",
      delete: "Rolle gelöscht",
    },
    module: {
      enable: "Modul/Funktion eingeschaltet",
      disable: "Modul/Funktion ausgeschaltet",
    },
    settings: {
      workshop: "Werkstatt-Profil geändert",
      appointments: "Termin-Einstellungen geändert",
      tires: "Reifen-Einstellungen geändert",
      security: "Sicherheits-Einstellungen geändert",
    },
    appointment: {
      delete: "Termin gelöscht",
    },
    customer: {
      delete: "Kunde gelöscht",
    },
    vehicle: {
      delete: "Fahrzeug gelöscht",
      transfer: "Fahrzeug umgeschrieben",
    },
    tires: {
      delete: "Reifensatz gelöscht",
    },
    invoice: {
      delete: "Rechnung gelöscht",
    },
    employee: {
      delete: "Mitarbeiter gelöscht",
    },
    fleet: {
      delete: "Fuhrpark-Eintrag gelöscht",
    },
    network: {
      delete: "Netzwerk-Eintrag gelöscht",
    },
    docs: {
      delete: "Dokumentation gelöscht",
      categoryDelete: "Dokumentations-Kapitel gelöscht",
    },
  },
};
