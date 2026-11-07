/**
 * Liest eine große Abfrage Seite für Seite (Cursor) – für Exporte, die nie alle Zeilen auf einmal im Speicher halten. `fetch` bekommt die Kennung der letzten Zeile der
 * Vorseite (oder `undefined`) und liefert höchstens `size` Zeilen in einer **stabilen Reihenfolge, die mit der Kennung endet** (z. B. `orderBy: [{ lastName: "asc" }, { id: "asc" }]`).
 */
export async function* paged<T extends { id: string }>(fetch: (page: { take: number; cursor?: string }) => Promise<T[]>, size = 500): AsyncGenerator<T> {
  let cursor: string | undefined;
  for (;;) {
    const batch = await fetch({ take: size, cursor });
    for (const row of batch) yield row;
    if (batch.length < size) return;
    cursor = batch[batch.length - 1].id;
  }
}

/** Prisma-Argumente für die nächste Seite: ab (ausschließlich) der Kennung. */
export const pageArgs = (page: { take: number; cursor?: string }) => ({ take: page.take, ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}) });
