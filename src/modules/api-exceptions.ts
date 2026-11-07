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
  "docs.savePage": "Dokumentationsseiten (Handbuch, IT-Dokumentation: Markdown mit Versionen und Bildern, Kapitel mit Sichtbarkeit je Rolle) sind redaktionelle Inhalte für Menschen, kein Datenaustausch – Schreiben gibt es bewusst nicht über die API (Entscheid des Entwicklungsteams, vom Nutzer zu bestätigen). Das **Handbuch** ist lesend verfügbar (GET /manual-pages, nur Seiten ohne Rollenbeschränkung); die **IT-Dokumentation** nie, denn sie kann Zugangswissen enthalten, das nicht über ein Token abfließen soll.",
  "docs.deletePage": "Dokumentationsseiten (Rechte je Bereich und Kapitel, Versionsverlauf) werden nur in der Oberfläche gepflegt; über die API ist nur das Handbuch lesbar (Entscheid des Entwicklungsteams, siehe docs.savePage).",
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

/**
 * **Datei-Wege der Oberfläche** (Routen unter `src/app/api`, die Dateien annehmen oder ausliefern – Teilfähigkeiten Upload/Download neben den Operationen): jede steht entweder mit ihrem API-Pendant
 * (`api`: Operations-IDs der Endpunkte, der Vertragstest `src/modules/api.test.ts` prüft, dass es sie gibt) oder mit Begründung (`reason`) hier. Eine neue Route mit Schreibmethode oder Dateiauslieferung, die nicht
 * hier steht, bricht den Test. Die Liste darf nur schrumpfen (ein Eintrag ohne solche Route bricht ihn ebenfalls).
 */
export type FileRouteEntry = { api: readonly string[]; reason?: undefined } | { api?: undefined; reason: string };
export const FILE_ROUTES: Readonly<Record<string, FileRouteEntry>> = {
  "api/files": { api: ["files.upload"] },
  "api/files/[id]": { api: ["files.content"] },
  "api/invoices/[id]/file": { api: ["invoices.fileDownload"] },
  "api/billing/[id]/xml": { api: ["billing-documents.xml"] },
  "api/docs/images": { reason: "Bilder der Dokumentation (Handbuch, IT-Dokumentation) gehören zu den redaktionellen Seiten, die bewusst nicht beschreibbar über die API sind (Entscheid des Entwicklungsteams, vom Nutzer zu bestätigen, siehe docs.savePage); das Handbuch ist lesend verfügbar, Bilder darin nur im Browser." },
  "api/docs/images/[id]": { reason: "Bilder der Dokumentation werden nur im Browser mit den Seiten der Dokumentation ausgeliefert (Rechte je Bereich und Kapitel); die API bietet das Handbuch als Text, die IT-Dokumentation gar nicht (siehe docs.savePage)." },
  "api/invoices/e-invoice": { reason: "Liest eine hochgeladene E-Rechnung (XML) nur aus und liefert Felder für das Formular zurück – schreibt nichts; eine Integration legt Rechnungen mit ihren Feldern über POST /invoices an." },
  "api/checklists/[id]/signature": { reason: "Die Unterschrift am Tablet ist ein personenbezogenes Beweismittel und wird nur in der Oberfläche mit Rechteprüfung ausgeliefert; die API meldet nur den Zustand der Checkliste." },
  "api/orders/approvals/[id]/signature": { reason: "Die Unterschrift einer Freigabe ist ein personenbezogenes Beweismittel und wird nur in der Oberfläche ausgeliefert; die API zeigt das Protokoll der Freigabe (GET /order-approvals) ohne Bild." },
  "api/logo": { reason: "Das Werkstatt-Logo ist Plattform (Werkstattprofil, öffentlich für Anmeldeseite und Belege): Einstellung der Verwaltung, nie API-Ressource." },
  "api/backups/upload": { reason: "Backups einspielen ist Verwaltung (Plattform): nie API-Ressource." },
  "api/setup/restore": { reason: "Wiederherstellung in der Einrichtung (Plattform, mit Einrichtungs-Token): nie API-Ressource." },
  "api/exchange/[kind]/import": { reason: "CSV-Import (Datenaustausch): nur mit Sitzung und eigenem Recht je Datenart, siehe NOT_API_OPERATIONS." },
};
