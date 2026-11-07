/**
 * Öffentliche Schnittstelle der Funktion workshop.customers. Andere Funktionen importieren NUR aus dieser Datei
 * (und nur, wenn sie die Funktion in `requires`/`uses` ihrer feature.ts deklariert haben).
 */
export { customerDisplayName } from "./domain";
export { findCustomerIdsByNumber, numberKey } from "./lookup";
export { customerContacts, customerNameSelect, customerTitle, unrestrictedCustomerWhere, type CustomerContact } from "./queries";
