"use server";

import { formObject } from "@/lib/forms";
import { defineAction } from "@/server/operations";
import { countOperation, receiptOperation, saveArticleOperation, setArchivedOperation } from "./operations";

/** Artikel anlegen/ändern. Preisfelder gibt es im Formular nur mit `parts.prices`; `pricesShown` sagt, dass leere Preisfelder „löschen“ heißen (sonst bleiben die Preise). */
function articleForm(fd: FormData): unknown {
  const raw: Record<string, string> = formObject(fd);
  const shown = raw.pricesShown !== undefined;
  delete raw.pricesShown;
  return shown ? { ...raw, purchase: raw.purchase ?? "", sale: raw.sale ?? "" } : raw;
}

export const saveArticle = defineAction(saveArticleOperation, {
  form: articleForm,
  revalidate: (data) => ["/parts", "/", `/parts/${data.id}`],
  redirect: (data) => `/parts/${data.id}`,
  message: "common.saved",
});

export const setArticleArchived = defineAction(setArchivedOperation, { revalidate: (data) => ["/parts", "/", `/parts/${data.id}`], message: "common.saved" });

/** Wareneingang (Formular mit `articleId`, `quantity`, `reference`, `note`). */
export const receiveStock = defineAction(receiptOperation, {
  revalidate: (data) => ["/parts", "/", `/parts/${data.articleId}`],
  redirect: (data) => `/parts/${data.articleId}`,
  message: "parts.notices.received",
});

/** Inventur: die Felder `count.<Artikel>` ergeben die gezählten Mengen. */
export const bookCount = defineAction(countOperation, {
  form: (fd) => {
    const raw = formObject(fd);
    const counts: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) if (key.startsWith("count.")) counts[key.slice(6)] = value;
    return { counts, note: raw.note };
  },
  revalidate: ["/parts", "/", "/parts/count"],
  redirect: "/parts",
  message: "parts.notices.counted",
});
