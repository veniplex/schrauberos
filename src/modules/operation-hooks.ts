import type { OperationHookDef } from "@/server/operations/hooks";

/**
 * Composition Root der transaktionalen Hooks (wird nur von `src/server/operations/hooks.ts` importiert – nicht über `registry.ts`, das jede Seite lädt): Funktionen tragen hier ihre synchronen
 * Abonnenten für Operationen anderer Funktionen ein, z. B. `...invoicesHooks` aus `./office/invoices/hooks`. Die auslösende
 * Funktion kennt sie nicht. Aktuell gibt es noch keine.
 */
export const operationHooks: readonly OperationHookDef[] = [];
