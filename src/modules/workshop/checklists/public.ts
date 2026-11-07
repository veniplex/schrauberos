/**
 * Öffentliche Schnittstelle der Funktion workshop.checklists. Andere Funktionen importieren NUR aus dieser Datei (und nur, wenn sie die Funktion in `requires`/`uses` ihrer feature.ts deklariert haben).
 *
 *  - `intakeProtocol`/`checklistProtocol`: das **Annahmeprotokoll** (bzw. eine Checkliste) samt Punkten und Unterschrift-Referenz für den Druck (F8) – mit denselben Rechten und Sperren wie die Detailseite
 *    (kein Recht oder Kunde mit eingeschränkter Verarbeitung: `null`),
 *  - `readProtocolSignature`: die Bytes der gezeichneten Unterschrift (PNG) einer abgeschlossenen Checkliste, ebenso rechtegeprüft.
 */
export { checklistProtocol, intakeProtocol, readProtocolSignature, type ChecklistProtocol } from "./queries";
