/** Art einer Lagerbewegung. Die Werte sind API-Vertrag. */
export const MOVEMENT_KINDS = ["receipt", "order", "correction", "reversal"] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

/** Kennung, mit der Positionen eines Auftrags (`OrderItem.refType`) auf einen Artikel verweisen. */
export const ARTICLE_REF = "article";

/** Einheiten, die das Formular vorschlägt (frei wählbar). */
export const UNIT_SUGGESTIONS = ["Stk", "l", "kg", "m", "Satz", "Pkg"] as const;
