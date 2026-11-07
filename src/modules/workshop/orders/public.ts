/**
 * Öffentliche Schnittstelle der Funktion workshop.orders. Andere Funktionen importieren NUR aus dieser Datei
 * (und nur, wenn sie die Funktion in `requires`/`uses` ihrer feature.ts deklariert haben).
 *
 *  - `OrderChange`: das Ergebnis von `orders.close`/`orders.reopen`/`orders.setStatus`, auf das sich Hooks anderer Funktionen stützen,
 *  - `createOrderOperation`: für „Angebot → Auftrag“ (F3) als eigene Operation,
 *  - `createOrderInTx`: dasselbe **in der Transaktion des Aufrufers** (Angebot annehmen und Auftrag anlegen nur gemeinsam; Recht `orders.create`, Audit und Hooks laufen mit),
 *  - `orderLines`: Positionen ohne Preise für Abschnitte auf der Auftragsseite.
 */
export { ORDER_STATUSES, type OrderStatus } from "./constants";
export { isOpen as isOrderOpen } from "./domain";
export { createOrderInTx, createOrderOperation, type OrderChange } from "./operations";
export { orderLines } from "./queries";
