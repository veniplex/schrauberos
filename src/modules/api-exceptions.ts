/**
 * Schreibende UI-Aktionen ohne API-Pendant – jeweils mit Begründung (Vertragstest `src/modules/api.test.ts`). Die Liste darf nur schrumpfen: Ein Eintrag, der
 * inzwischen einen API-Endpunkt hat oder keine Operation mehr bezeichnet, bricht den Test.
 *
 * Nicht aufgeführt (der Test nimmt sie automatisch aus): Operationen der Plattform-/Verwaltungsfunktionen (Benutzer, Rollen, Einstellungen, Module,
 * Backups, Updates, Audit – dort verlangt die Operation ein Recht einer Pflichtfunktion) und Operationen jeder angemeldeten Person (`authenticated`: Konto,
 * Anzeigeeinstellungen). Beides sind nie API-Ressourcen.
 */
export const API_EXCEPTIONS: Readonly<Record<string, string>> = {
  "parts.count": "Inventur: eine Zählung vor Ort mit Soll-/Ist-Abgleich in der Oberfläche; die API bucht Bestand nur über den Wareneingang (POST /stock-movements).",
  "orders.reopen": "Wieder öffnen hebt einen Abschluss samt den Rückbuchungen anderer Funktionen auf (eigenes, gekennzeichnetes Recht orders.reopen): eine bewusste Handlung in der Oberfläche, kein Weg für Integrationen.",
  "orders.removeFinding": "Befunde sind Aufzeichnungen der Werkstatt; die API legt sie nur an. Entfernen ist eine Korrektur in der Oberfläche.",
  "customers.restrict": "Datenschutzvorgang (Art. 18 DSGVO) mit Sonderrecht customers.privacy: nur in der Oberfläche; eingeschränkte Kunden gibt es für die API nicht (404).",
  "customers.unrestrict": "Datenschutzvorgang (Art. 18 DSGVO) mit Sonderrecht customers.privacy: nur in der Oberfläche; eingeschränkte Kunden gibt es für die API nicht (404).",
  "customers.anonymize": "Unumkehrbarer Datenschutzvorgang (Art. 17 DSGVO) mit Sonderrecht customers.privacy und Rückfrage: nur in der Oberfläche.",
  "appointments.saveSettings": "Kalender-Konfiguration (Zeitraster, Tagesgrenzen) – Einstellung der Oberfläche, keine Stammdaten zum Austausch.",
  "appointments.saveBay": "Arbeitsplätze sind Konfiguration (Recht appointments.configure); die API liest sie nur (GET /bays), damit Termine darauf verweisen können.",
  "appointments.deleteBay": "Arbeitsplätze sind Konfiguration (Recht appointments.configure); die API liest sie nur (GET /bays).",
  "appointments.archiveBay": "Arbeitsplätze sind Konfiguration (Recht appointments.configure); die API liest sie nur (GET /bays, Feld active).",
  "appointments.archiveType": "Terminarten sind Konfiguration (Recht appointments.configure); die API liest sie nur (GET /appointment-types, Feld active).",
  "appointments.saveType": "Terminarten sind Konfiguration (Recht appointments.configure); die API liest sie nur (GET /appointment-types).",
  "appointments.deleteType": "Terminarten sind Konfiguration (Recht appointments.configure); die API liest sie nur (GET /appointment-types).",
  "docs.savePage": "Dokumentationsseiten (Markdown mit Versionen und Bildern, Lese-/Schreibrecht je Bereich und Kapitel) sind bewusst nicht Teil des API-Kerns; bei Bedarf mit F11.",
  "docs.deletePage": "Dokumentationsseiten (Rechte je Bereich und Kapitel, Versionsverlauf) sind bewusst nicht Teil des API-Kerns; bei Bedarf mit F11.",
  "docs.togglePin": "Anheften ist eine Ansichtsfunktion der Dokumentation, kein Datenaustausch.",
  "docs.restoreVersion": "Versionsverlauf der Dokumentation: Wiederherstellen ist eine Redaktionsaufgabe in der Oberfläche.",
  "docs.saveCategory": "Kapitel der Dokumentation (Sichtbarkeit je Rolle) sind Konfiguration in der Oberfläche.",
  "docs.deleteCategory": "Kapitel der Dokumentation (Sichtbarkeit je Rolle) sind Konfiguration in der Oberfläche.",
};

/**
 * Operationen, die nicht über eine Server Action der Oberfläche laufen und deshalb nicht in der Liste oben stehen müssen – und trotzdem **nie** API-Ressourcen sind
 * (Vertragstest `src/modules/api.test.ts` prüft: kein Endpunkt nennt sie, jeder Eintrag ist eine Import-Operation des Datenaustauschs). Export und Import (CSV) laufen über
 * `/api/exchange/<art>` mit Sitzung und eigenem Recht je Datenart (`<funktion>.export`/`<funktion>.import`, in keiner Standardrolle), nicht über Token: Eine Massenübernahme
 * oder ein Massenabzug personenbezogener Daten gehört nicht in eine Integration, die sich ein Token ausstellt – dafür gibt es die Ressourcen der API mit ihren Seiten und Grenzen.
 */
export const NOT_API_OPERATIONS: Readonly<Record<string, string>> = {
  "customers.import": "CSV-Import der Kunden (Datenaustausch): nur mit Sitzung und eigenem Recht customers.import; keine API-Ressource.",
  "vehicles.import": "CSV-Import der Fahrzeuge (Datenaustausch): nur mit Sitzung und eigenem Recht vehicles.import; keine API-Ressource.",
  "tires.import": "CSV-Import der Reifensätze (Datenaustausch): nur mit Sitzung und eigenem Recht tires.import; keine API-Ressource.",
  "invoices.import": "CSV-Import ins Rechnungsarchiv (Datenaustausch): nur mit Sitzung und eigenem Recht invoices.import; keine API-Ressource.",
};
