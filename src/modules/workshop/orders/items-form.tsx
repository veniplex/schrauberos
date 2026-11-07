"use client";

import type { ReactNode } from "react";
import { Form, FormActions } from "@/components/ui/form";
import { LineItemEditor, type LineItemInitial } from "@/components/ui/line-item-editor";
import { useI18n } from "@/i18n/client";
import { ORDER_ITEM_KINDS } from "./constants";
import { saveOrderItems } from "./actions";

/**
 * Positionen eines offenen Auftrags: der Positionen-Editor (Art, Menge, Einheit, Netto-Einzelpreis, Steuersatz, Rabatt, Summen). `tools` ist der Platz für Werkzeuge anderer Funktionen,
 * die Positionen einfügen (Artikel aus Teile & Lager) – sie sprechen mit dem Editor über das Ereignis `LINE_ITEM_ADD_EVENT`, der Auftrag kennt sie nicht.
 * Nur mit `orders.prices` (die Seite zeigt das Formular sonst nicht).
 */
export function OrderItemsForm({ id, version, items, exempt, tools }: { id: string; version: string; items: readonly LineItemInitial[]; exempt: boolean; tools?: ReactNode }) {
  const { t, td } = useI18n();
  const kinds = ORDER_ITEM_KINDS.map((value) => ({ value, label: td(`orders.kinds.${value}`, value) }));
  return (
    <Form action={saveOrderItems} draftKey={`order-items:${id}`} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
      {tools}
      <LineItemEditor initialItems={items} exempt={exempt} kinds={kinds} />
      <FormActions submitLabel={t("orders.items.save")} />
    </Form>
  );
}
