/**
 * Öffentliche Schnittstelle der Funktion workshop.orders. Andere Funktionen importieren NUR aus dieser Datei
 * (und nur, wenn sie die Funktion in `requires`/`uses` ihrer feature.ts deklariert haben).
 *
 *  - `OrderChange`: das Ergebnis von `orders.close`/`orders.reopen`/`orders.setStatus`, auf das sich Hooks anderer Funktionen stützen,
 *  - `createOrderOperation`: für „Angebot → Auftrag“ (F3),
 *  - `orderLines`: Positionen ohne Preise für Abschnitte auf der Auftragsseite.
 */
export { ORDER_STATUSES, type OrderStatus } from "./constants";
export { isOpen as isOrderOpen } from "./domain";
export { createOrderOperation, type OrderChange } from "./operations";
export { orderLines } from "./queries";
