/**
 * Öffentliche Schnittstelle der Funktion workshop.customers. Andere Funktionen importieren NUR aus dieser Datei
 * (und nur, wenn sie die Funktion in `requires`/`uses` ihrer feature.ts deklariert haben).
 * Client-Komponenten importieren stattdessen aus `client.ts` (nur client-sichere Teile; `public.ts` bringt Abfragen mit).
 */
export { customerDisplayName } from "./client";
export { findCustomerIdsByNumber, numberKey } from "./lookup";
export { customerContacts, customerForDocument, customerNameSelect, customerTitle, isRestricted, isUnusable, restrictedCustomerWhere, restrictionSelect, searchableCustomerWhere, unrestrictedByCustomer, unrestrictedByOptionalVehicle, unrestrictedByVehicle, unrestrictedCustomerWhere, unrestrictedDocument, unrestrictedOrder, usabilitySelect, type CustomerContact } from "./queries";
