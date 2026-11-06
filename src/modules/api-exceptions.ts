/**
 * Schreibende UI-Aktionen ohne API-Pendant – jeweils mit Begründung (Vertragstest `src/modules/api.test.ts`). Die Liste darf nur schrumpfen: Ein Eintrag, der
 * inzwischen einen API-Endpunkt hat oder keine Operation mehr bezeichnet, bricht den Test.
 *
 * Nicht aufgeführt (der Test nimmt sie automatisch aus): Operationen der Plattform-/Verwaltungsfunktionen (Benutzer, Rollen, Einstellungen, Module,
 * Backups, Updates, Audit – dort verlangt die Operation ein Recht einer Pflichtfunktion) und Operationen jeder angemeldeten Person (`authenticated`: Konto,
 * Anzeigeeinstellungen). Beides sind nie API-Ressourcen.
 */
export const API_EXCEPTIONS: Readonly<Record<string, string>> = {
  "appointments.saveSettings": "Kalender-Konfiguration (Zeitraster, Tagesgrenzen) – Einstellung der Oberfläche, keine Stammdaten zum Austausch.",
  "appointments.saveBay": "Arbeitsplätze sind Konfiguration (Recht appointments.configure); die API liest sie nur (GET /bays), damit Termine darauf verweisen können.",
  "appointments.deleteBay": "Arbeitsplätze sind Konfiguration (Recht appointments.configure); die API liest sie nur (GET /bays).",
  "appointments.saveType": "Terminarten sind Konfiguration (Recht appointments.configure); die API liest sie nur (GET /appointment-types).",
  "appointments.deleteType": "Terminarten sind Konfiguration (Recht appointments.configure); die API liest sie nur (GET /appointment-types).",
  "docs.savePage": "Dokumentationsseiten (Markdown mit Versionen und Bildern, Lese-/Schreibrecht je Bereich und Kapitel) sind bewusst nicht Teil des API-Kerns; bei Bedarf mit F11.",
  "docs.deletePage": "Dokumentationsseiten (Rechte je Bereich und Kapitel, Versionsverlauf) sind bewusst nicht Teil des API-Kerns; bei Bedarf mit F11.",
  "docs.togglePin": "Anheften ist eine Ansichtsfunktion der Dokumentation, kein Datenaustausch.",
  "docs.restoreVersion": "Versionsverlauf der Dokumentation: Wiederherstellen ist eine Redaktionsaufgabe in der Oberfläche.",
  "docs.saveCategory": "Kapitel der Dokumentation (Sichtbarkeit je Rolle) sind Konfiguration in der Oberfläche.",
  "docs.deleteCategory": "Kapitel der Dokumentation (Sichtbarkeit je Rolle) sind Konfiguration in der Oberfläche.",
};
