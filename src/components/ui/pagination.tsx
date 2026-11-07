import { ChevronLeft, ChevronRight } from "lucide-react";
import { getI18n } from "@/i18n/server";
import { pageCount } from "@/lib/list-params";
import { LinkButton } from "./buttons";

/**
 * Seitenwahl unter einer Liste: „1–25 von 230“, Vorherige/Nächste Seite, „Seite 2 von 10“. Erscheint nur, wenn es mehr als eine Seite gibt.
 * `hrefFor(page)` baut die Adresse der Seite (Filter und Sortierung bleiben erhalten, siehe `listHref`).
 */
export async function Pagination({ page, pageSize, total, hrefFor }: { page: number; pageSize: number; total: number; hrefFor: (page: number) => string }) {
  const pages = pageCount(total, pageSize);
  if (pages <= 1) return null;
  const { t } = await getI18n();
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label={t("common.pagination")} className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
      <p className="text-sm text-ink-muted tabular">
        {t("common.range", { from, to, total })}
        <span className="sr-only"> · {t("common.pageOf", { page, pages })}</span>
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <LinkButton href={hrefFor(page - 1)} variant="secondary" rel="prev" aria-label={t("common.previousPage")}>
            <ChevronLeft className="size-4" aria-hidden />
            <span className="max-sm:sr-only">{t("common.previous")}</span>
          </LinkButton>
        ) : null}
        <span className="text-sm tabular text-ink-muted max-sm:hidden" aria-hidden>
          {t("common.pageOf", { page, pages })}
        </span>
        {page < pages ? (
          <LinkButton href={hrefFor(page + 1)} variant="secondary" rel="next" aria-label={t("common.nextPage")}>
            <span className="max-sm:sr-only">{t("common.next")}</span>
            <ChevronRight className="size-4" aria-hidden />
          </LinkButton>
        ) : null}
      </div>
    </nav>
  );
}
