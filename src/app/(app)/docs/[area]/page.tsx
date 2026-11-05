import type { Metadata } from "next";
import clsx from "clsx";
import Link from "next/link";
import { Pin, Plus, Search, Trash2 } from "lucide-react";
import { Badge, EmptyState, PageHeader } from "@/components/ui/layout";
import { ConfirmSubmitButton, LinkButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
import { db } from "@/server/db";
import { contains } from "@/server/search";
import { requireDocArea } from "@/modules/docs/access";
import { deleteDocCategory } from "@/modules/docs/actions";
import { CategoryForm } from "@/modules/docs/category-form";

export async function generateMetadata({ params }: { params: Promise<{ area: string }> }): Promise<Metadata> {
  const { area } = await params;
  const { t, has } = await getI18n();
  return { title: has(`docs.areas.${area}.title`) ? t(`docs.areas.${area}.title` as never) : t("nav.docs") };
}

/** Markdown-Zeichen entfernen und kürzen – für die Vorschau in der Liste. */
function snippet(md: string, max = 150) {
  const text = md.replace(/```[\s\S]*?```/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#>*_`|~-]+/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()} …` : text;
}

export default async function DocsIndexPage({ params, searchParams }: { params: Promise<{ area: string }>; searchParams: Promise<{ q?: string; cat?: string }> }) {
  const [{ area: areaParam }, sp] = await Promise.all([params, searchParams]);
  const { area, canEdit } = await requireDocArea(areaParam);
  const { t, tp, date } = await getI18n();
  const q = (sp.q ?? "").trim();

  const [categories, pages] = await Promise.all([
    db.docCategory.findMany({ where: { area }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { pages: true } } } }),
    db.docPage.findMany({
      where: {
        area,
        ...(sp.cat === "none" ? { categoryId: null } : sp.cat ? { categoryId: sp.cat } : {}),
        ...(q ? { OR: [{ title: contains(q) }, { content: contains(q) }] } : {}),
      },
      include: { category: true },
      orderBy: [{ pinned: "desc" }, { title: "asc" }],
    }),
  ]);
  const total = categories.reduce((n, c) => n + c._count.pages, 0);
  const base = `/docs/${area}`;
  const catLink = (href: string, label: string, count: number | null, active: boolean) => (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={clsx("flex min-h-9 items-center justify-between gap-2 rounded-md px-3 py-1.5 text-sm", active ? "bg-accent-subtle font-medium text-accent-text" : "text-ink-muted hover:bg-surface-hover hover:text-ink")}
    >
      <span className="truncate">{label}</span>
      {count != null ? <span className="text-xs tabular">{count}</span> : null}
    </Link>
  );

  return (
    <>
      <PageHeader
        title={t(`docs.areas.${area}.title`)}
        description={t(`docs.areas.${area}.description`)}
        actions={
          canEdit ? (
            <LinkButton href={`${base}/new${sp.cat && sp.cat !== "none" ? `?cat=${sp.cat}` : ""}`} variant="primary">
              <Plus className="size-4" aria-hidden /> {t("docs.new")}
            </LinkButton>
          ) : null
        }
      />

      <div className="grid gap-5 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <aside className="flex flex-col gap-1">
          {catLink(base, t("docs.allPages"), null, !sp.cat)}
          {categories.map((c) => catLink(`${base}?cat=${c.id}`, c.name, c._count.pages, sp.cat === c.id))}
          {catLink(`${base}?cat=none`, t("docs.noCategory"), null, sp.cat === "none")}
          {canEdit ? (
            <details className="mt-3 rounded-md border border-line bg-surface p-2">
              <summary className="cursor-pointer px-1 py-1 text-xs font-medium text-ink-muted">{t("docs.manageCategories")}</summary>
              <ul className="mt-2 flex flex-col gap-2">
                {categories.map((c) => (
                  <li key={c.id} className="flex items-start gap-1.5">
                    <div className="min-w-0 flex-1">
                      <CategoryForm area={area} initial={{ id: c.id, name: c.name, sortOrder: c.sortOrder }} />
                    </div>
                    <form action={deleteDocCategory}>
                      <input type="hidden" name="area" value={area} />
                      <input type="hidden" name="id" value={c.id} />
                      <ConfirmSubmitButton message={t("docs.categoryDeleteConfirm")} aria-label={t("common.delete")}>
                        <Trash2 className="size-3.5" aria-hidden />
                      </ConfirmSubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
              <div className="mt-3 border-t border-line pt-3">
                <CategoryForm area={area} />
              </div>
            </details>
          ) : null}
          <p className="mt-2 px-3 text-xs text-ink-muted">{tp("docs.count", total)}</p>
        </aside>

        <div className="min-w-0">
          <form method="get" className="relative mb-4">
            {sp.cat ? <input type="hidden" name="cat" value={sp.cat} /> : null}
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
            <input name="q" defaultValue={q} className="input pl-9" placeholder={t("docs.searchPlaceholder")} aria-label={t("common.search")} />
          </form>

          {pages.length === 0 ? (
            <div className="card">
              <EmptyState title={q ? t("common.noResults") : t("docs.empty")} hint={q ? undefined : t("docs.emptyHint")} action={canEdit && !q ? <LinkButton href={`${base}/new`} variant="primary">{t("docs.new")}</LinkButton> : undefined} />
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {pages.map((p) => (
                <li key={p.id}>
                  <Link href={`${base}/${p.slug}`} className="card card-pad block transition-colors hover:bg-surface-hover">
                    <div className="flex flex-wrap items-center gap-2">
                      {p.pinned ? <Pin className="size-4 text-accent-text" aria-label={t("docs.pinned")} /> : null}
                      <h2 className="font-semibold">{p.title}</h2>
                      {p.category ? <Badge>{p.category.name}</Badge> : null}
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{snippet(p.content)}</p>
                    <p className="mt-2 text-xs text-ink-muted">
                      {t("docs.updated", { date: date(p.updatedAt), who: p.updatedByName ?? "–" })}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
