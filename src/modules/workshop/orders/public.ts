/**
 * Öffentliche Schnittstelle der Funktion workshop.orders. Andere Funktionen importieren NUR aus dieser Datei
 * (und nur, wenn sie die Funktion in `requires`/`uses` ihrer feature.ts deklariert haben).
 *
 *  - `OrderChange`: das Ergebnis von `orders.close`/`orders.reopen`/`orders.setStatus`, auf das sich Hooks anderer Funktionen stützen,
 *  - `createOrderOperation`: für „Angebot → Auftrag“ (F3) als eigene Operation,
 *  - `createOrderInTx`: dasselbe **in der Transaktion des Aufrufers** (Angebot annehmen und Auftrag anlegen nur gemeinsam; Recht `orders.create`, Audit und Hooks laufen mit),
 *  - `orderLines`: Positionen ohne Preise für Abschnitte auf der Auftragsseite,
 *  - `orderRef`/`orderLabels`/`stampableOrders`: Nummer, Status und Kennzeichen für Funktionen, die sich an einen Auftrag hängen (Zeiterfassung, Dokumente, Checklisten),
 *  - `appendOrderItems`: Positionen in der Transaktion des Aufrufers anhängen (Zeiten als Positionen übernehmen).
 */
export { ORDER_STATUSES, type OrderStatus } from "./constants";
export { isOpen as isOrderOpen } from "./domain";
export { appendOrderItems, createOrderInTx, createOrderOperation, type AppendedLine, type OrderChange } from "./operations";
export { orderLabels, orderLines, orderRef, stampableOrders } from "./queries";
