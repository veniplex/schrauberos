import clsx from "clsx";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/ui/markdown";
import { PageHeader } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { CatalogView } from "./catalog-view";
import { listHandbook, readHandbookPage } from "./docs";

export const CATALOG_SLUG = "katalog";

/** Handbuch-Seite mit Kapitelliste links und Inhaltsverzeichnis der Seite. Das Recht prüft die aufrufende Route. */
export async function HandbookView({ slug }: { slug?: string }) {
  const { t } = await getI18n();
  const chapters = await listHandbook();
  const current = slug ?? chapters[0]?.slug;
  const isCatalog = current === CATALOG_SLUG;
  const page = isCatalog || !current ? null : await readHandbookPage(current);
  if (!isCatalog && !page) notFound();

  const nav = [...chapters, { slug: CATALOG_SLUG, title: t("handbook.catalogTitle") }];
  const title = page ? page.title : t("handbook.catalogTitle");

  return (
    <>
      <PageHeader title={t("handbook.title")} description={t("handbook.description")} />
      <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)] xl:grid-cols-[14rem_minmax(0,1fr)_14rem]">
        <nav aria-label={t("handbook.contents")} className="flex gap-1 overflow-x-auto lg:flex-col">
          {nav.map((c) => (
            <Link
              key={c.slug}
              href={`/admin/handbook/${c.slug}`}
              aria-current={c.slug === current ? "page" : undefined}
              className={clsx(
                "whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium",
                c.slug === current ? "bg-accent-subtle text-accent-text" : "text-ink-muted hover:bg-surface-hover hover:text-ink",
              )}
            >
              {c.title}
            </Link>
          ))}
        </nav>

        <article className="card card-pad min-w-0">
          <h2 className="mb-4 text-xl font-semibold">{title}</h2>
          {page ? <Markdown source={page.body} /> : <CatalogView />}
        </article>

        {page && page.headings.length > 0 ? (
          <aside className="hidden xl:block">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t("handbook.contents")}</p>
            <ul className="sticky top-6 flex flex-col gap-1 text-sm">
              {page.headings.map((h) => (
                <li key={h.id} className={h.level === 3 ? "pl-3" : undefined}>
                  <a href={`#${h.id}`} className="text-ink-muted hover:text-ink">
                    {h.text}
                  </a>
                </li>
              ))}
            </ul>
          </aside>
        ) : null}
      </div>
    </>
  );
}
