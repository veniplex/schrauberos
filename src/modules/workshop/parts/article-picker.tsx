"use client";

import { useState } from "react";
import { Field } from "@/components/ui/form";
import { SearchCombobox, type SearchOption } from "@/components/ui/search-combobox";
import { useI18n } from "@/i18n/client";
import { centsToInputFor } from "@/lib/money";
import { LINE_ITEM_ADD_EVENT, scaledToInput, type LineItemAddDetail } from "@/lib/line-items";
import { ARTICLE_REF } from "./constants";

export type PickerOption = SearchOption & { name: string; unit: string; taxBp: number; stockMilli: number; saleCents?: number | null };

/**
 * „Artikel einfügen“ im Positionen-Editor des Auftrags: Auswahl eines Artikels fügt eine Position hinzu – Bezeichnung, Einheit, Verkaufspreis und Steuersatz sind vorbelegt (und bleiben
 * änderbar), Art „Teil“, Verweis auf den Artikel. Der Editor kennt den Artikel nicht, er bekommt das Ereignis `LINE_ITEM_ADD_EVENT`. Ohne `parts.prices` kommt kein Preis mit (die Position
 * bleibt ohne Preis, der Preis wird von Hand eingetragen).
 */
export function ArticlePicker({ editor = "items", context = "order" }: { editor?: string; /** `billing`: Positionen eines Angebots oder einer Rechnung – dort wird nichts gebucht */ context?: "order" | "billing" }) {
  const { t, locale } = useI18n();
  const [key, setKey] = useState(0);

  function pick(option: PickerOption | null) {
    if (!option) return;
    const detail: LineItemAddDetail = {
      name: editor,
      row: {
        description: option.name,
        unit: option.unit,
        quantity: "1",
        unitPrice: option.saleCents != null ? centsToInputFor(option.saleCents, locale) : "",
        taxRate: scaledToInput(option.taxBp, 2, locale),
        kind: "part",
        refType: ARTICLE_REF,
        refId: option.id,
      },
    };
    window.dispatchEvent(new CustomEvent(LINE_ITEM_ADD_EVENT, { detail }));
    // frisches Suchfeld für den nächsten Artikel
    setKey((n) => n + 1);
  }

  return (
    <Field label={t("parts.picker.label")} hint={t(context === "billing" ? "parts.picker.hintBilling" : "parts.picker.hint")}>
      <SearchCombobox<PickerOption>
        key={key}
        endpoint="/api/parts/search"
        name="articlePicker"
        placeholder={t("parts.picker.placeholder")}
        onChange={pick}
        renderOption={(o) => (
          <span className="flex min-w-0 items-center gap-2">
            <span className="tabular font-medium">{o.label}</span>
            <span className="truncate">{o.sublabel}</span>
          </span>
        )}
      />
    </Field>
  );
}
