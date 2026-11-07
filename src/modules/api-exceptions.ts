/**
 * Schreibende UI-Aktionen ohne API-Pendant – jeweils mit Begründung (Vertragstest `src/modules/api.test.ts`). Die Liste darf nur schrumpfen: Ein Eintrag, der
 * inzwischen einen API-Endpunkt hat oder keine Operation mehr bezeichnet, bricht den Test.
 *
 * Nicht aufgeführt (der Test nimmt sie automatisch aus): Operationen der Plattform-/Verwaltungsfunktionen (Benutzer, Rollen, Einstellungen, Module,
 * Backups, Updates, Audit – dort verlangt die Operation ein Recht einer Pflichtfunktion) und Operationen jeder angemeldeten Person (`authenticated`: Konto,
 * Anzeigeeinstellungen). Beides sind nie API-Ressourcen.
 */
export const API_EXCEPTIONS: Readonly<Record<string, string>> = {
  "checklists.saveTemplate": "Vorlagen pflegt die Leitung in der Oberfläche (Einrichtung der Werkstatt; jede Änderung ist eine neue Version): Die API liest die Vorlagen (GET /checklist-templates) und beginnt Checklisten daraus.",
  "checklists.archiveTemplate": "Vorlagen archivieren oder wieder aktivieren gehört zur Einrichtung der Werkstatt durch die Leitung: nur in der Oberfläche.",
  "checklists.installDefaults": "Die mitgelieferten Vorlagen einzurichten ist ein einmaliger Einrichtungsschritt der Leitung: nur in der Oberfläche.",
  "checklists.reopen": "Wieder öffnen hebt die Unveränderlichkeit einer abgeschlossenen Checkliste auf (gekennzeichnetes Recht checklists.reopen, Begründung Pflicht, Verlauf): eine bewusste Handlung in der Oberfläche, kein Weg für Integrationen.",
  "checklists.discard": "Verwerfen einer falsch begonnenen Checkliste ist eine Korrektur in der Oberfläche; die API beginnt, füllt aus und schließt ab.",
  "time.correct": "Eine Korrektur ändert einen Arbeitszeitnachweis und braucht die Begründung einer Person (Pflichtfeld, Korrekturverlauf): eine bewusste Handlung in der Oberfläche, kein Weg für Integrationen. Stempeln und Nachtragen gibt es über die API.",
  "time.void": "Stornieren nimmt einen Arbeitszeitnachweis aus der Zählung und braucht die Begründung einer Person: nur in der Oberfläche (der Eintrag bleibt mit Begründung im Verlauf).",
  "time.transfer": "Zeiten als Auftragspositionen übernehmen ist ein Abrechnungsschritt mit Rückfrage am Auftrag (Preise, Stundensatz aus dem Profil): in der Oberfläche; Positionen eines Auftrags schreibt die API über POST /orders/{id}/items.",
  "parts.count": "Inventur: eine Zählung vor Ort mit Soll-/Ist-Abgleich in der Oberfläche; die API bucht Bestand nur über den Wareneingang (POST /stock-movements).",
  "orders.reopen": "Wieder öffnen hebt einen Abschluss samt den Rückbuchungen anderer Funktionen auf (eigenes, gekennzeichnetes Recht orders.reopen): eine bewusste Handlung in der Oberfläche, kein Weg für Integrationen.",
  "orders.removeFinding": "Befunde sind Aufzeichnungen der Werkstatt; die API legt sie nur an. Entfernen ist eine Korrektur in der Oberfläche.",
  "customers.restrict": "Datenschutzvorgang (Art. 18 DSGVO) mit Sonderrecht customers.privacy: nur in der Oberfläche; eingeschränkte Kunden gibt es für die API nicht (404).",
  "customers.unrestrict": "Datenschutzvorgang (Art. 18 DSGVO) mit Sonderrecht customers.privacy: nur in der Oberfläche; eingeschränkte Kunden gibt es für die API nicht (404).",
  "customers.anonymize": "Unumkehrbarer Datenschutzvorgang (Art. 17 DSGVO) mit Sonderrecht customers.privacy und Rückfrage: nur in der Oberfläche.",
  "appointments.createFeed": "Abo-Adresse des Kalenders (F10): ein Zugang zu Daten außerhalb der Anwendung, den nur die Person selbst mit Sitzung und erneuter Passwortabfrage anlegt – nie ein Token für ein Token. Eine Integration liest Termine über die API.",
  "appointments.revokeFeed": "Abo-Adresse des Kalenders (F10) widerrufen: Sicherheitsvorgang des eigenen Kontos mit Passwortabfrage, nur in der Oberfläche.",
  "appointments.saveSettings": "Kalender-Konfiguration (Zeitraster, Tagesgrenzen) – Einstellung der Oberfläche, keine Stammdaten zum Austausch.",
  "appointments.saveBay": "Arbeitsplätze sind Konfiguration (Recht appointments.configure); die API liest sie nur (GET /bays), damit Termine darauf verweisen können.",
  "appointments.deleteBay": "Arbeitsplätze sind Konfiguration (Recht appointments.configure); die API liest sie nur (GET /bays).",
  "appointments.archiveBay": "Arbeitsplätze sind Konfiguration (Recht appointments.configure); die API liest sie nur (GET /bays, Feld active).",
  "appointments.archiveType": "Terminarten sind Konfiguration (Recht appointments.configure); die API liest sie nur (GET /appointment-types, Feld active).",
  "appointments.saveType": "Terminarten sind Konfiguration (Recht appointments.configure); die API liest sie nur (GET /appointment-types).",
  "appointments.deleteType": "Terminarten sind Konfiguration (Recht appointments.configure); die API liest sie nur (GET /appointment-types).",
  "docs.savePage": "Dokumentationsseiten (Handbuch, IT-Dokumentation: Markdown mit Versionen und Bildern, Lese-/Schreibrecht je Bereich und Kapitel) sind redaktionelle Inhalte für Menschen, kein Datenaustausch – bewusst keine API-Ressource (Entscheid F11); sie können Zugangswissen enthalten, das nicht über ein Token abfließen soll.",
  "docs.deletePage": "Dokumentationsseiten (Rechte je Bereich und Kapitel, Versionsverlauf) sind bewusst keine API-Ressource (Entscheid F11, siehe docs.savePage).",
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
