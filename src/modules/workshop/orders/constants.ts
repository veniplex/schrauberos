/**
 * Statuskette eines Werkstattauftrags: Angenommen → In Arbeit → Fertig (abholbereit) → Abgeholt (= abgeschlossen); dazu „Storniert“.
 * Die Werte sind API-Vertrag. „Abgeholt“ erreicht man nur über „Abschließen“ (`orders.close`, löst die Abbuchungen anderer Funktionen aus) und verlässt es nur über „Wieder öffnen“.
 */
export const ORDER_STATUSES = ["accepted", "in_progress", "ready", "picked_up", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Die Schritte der Kette für den `Stepper` (Storniert steht außerhalb). */
export const ORDER_STEPS = ["accepted", "in_progress", "ready", "picked_up"] as const satisfies readonly OrderStatus[];

/** Art einer Position. */
export const ORDER_ITEM_KINDS = ["labor", "part", "other"] as const;
export type OrderItemKind = (typeof ORDER_ITEM_KINDS)[number];

/** Art der Kundenfreigabe bei Mehrarbeit. */
export const APPROVAL_METHODS = ["signature", "typed", "phone"] as const;
export type ApprovalMethod = (typeof APPROVAL_METHODS)[number];

/** Ereignisse des Verlaufs. */
export const ORDER_EVENT_KINDS = ["created", "status", "reopened", "approval"] as const;
export type OrderEventKind = (typeof ORDER_EVENT_KINDS)[number];

/** Zähler der Auftragsnummer (`Counter.key`). */
export const ORDER_COUNTER = "orders";
