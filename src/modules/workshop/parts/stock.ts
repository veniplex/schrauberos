import type { Prisma } from "@/generated/prisma/client";
import type { MovementKind } from "./constants";

type Tx = Prisma.TransactionClient;

/**
 * Die eine Stelle, die den Bestand ändert (Wareneingang, Inventur, Auftragsabgang, Rückbuchung). Bewusst eigene Datei ohne Rahmen-Importe: Die Hooks (`hooks.ts`) laden sie, und die Hooks werden
 * vom Aktions-Rahmen geladen – eine Datei mit `defineOperation` an dieser Stelle wäre ein Importzirkel.
 */
/**
 * Bucht eine Menge auf einen Artikel: atomarer Zuwachs, Bewegung mit dem Stand danach. Für Wareneingang, Inventur und die Hooks der Aufträge. `delta` ist vorzeichenbehaftet.
 * Liefert `null`, wenn es den Artikel nicht gibt.
 */
export async function bookMovement(
  tx: Tx,
  input: { articleId: string; kind: MovementKind; delta: number; byName: string; orderId?: string; orderNumber?: string; reference?: string | null; note?: string | null },
): Promise<{ id: string; stockAfterMilli: number } | null> {
  const exists = await tx.article.findUnique({ where: { id: input.articleId }, select: { id: true, updatedAt: true } });
  if (!exists) return null;
  // `updatedAt` bleibt stehen (explizit zurückgeschrieben): Es ist die Version der Stammdaten für das Bearbeiten-Formular – eine Buchung ist kein Konflikt (wie die Anmeldezähler am Konto)
  const updated = await tx.article.update({ where: { id: input.articleId }, data: { stockMilli: { increment: input.delta }, updatedAt: exists.updatedAt }, select: { stockMilli: true } });
  const movement = await tx.stockMovement.create({
    data: {
      articleId: input.articleId,
      kind: input.kind,
      quantityMilli: input.delta,
      stockAfterMilli: updated.stockMilli,
      orderId: input.orderId ?? null,
      orderNumber: input.orderNumber ?? null,
      reference: input.reference ?? null,
      note: input.note ?? null,
      byName: input.byName,
    },
    select: { id: true },
  });
  return { id: movement.id, stockAfterMilli: updated.stockMilli };
}
