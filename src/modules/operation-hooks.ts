import type { OperationHookDef } from "@/server/operations/hooks";

import { hooks as appointmentsHooks } from "./workshop/appointments/hooks";
import { hooks as ordersHooks } from "./workshop/orders/hooks";
import { hooks as partsHooks } from "./workshop/parts/hooks";
import { hooks as tiresHooks } from "./workshop/tires/hooks";
import { hooks as vehiclesHooks } from "./workshop/vehicles/hooks";

/**
 * Composition Root der transaktionalen Hooks (wird nur von `src/server/operations/hooks.ts` importiert – nicht über `registry.ts`, das jede Seite lädt): Funktionen tragen hier ihre synchronen
 * Abonnenten für Operationen anderer Funktionen ein, z. B. `...invoicesHooks` aus `./office/invoices/hooks`. Die auslösende
 * Funktion kennt sie nicht. Aktuell: die Bereinigung beim Anonymisieren eines Kunden (`customers.anonymize`, P4b-5). **Reihenfolge zählt:** Die Reifen kommen vor den Fahrzeugen,
 * denn sie finden ihre Sätze über den Halter des Fahrzeugs.
 */
export const operationHooks: readonly OperationHookDef[] = [...tiresHooks, ...ordersHooks, ...partsHooks, ...appointmentsHooks, ...vehiclesHooks];
