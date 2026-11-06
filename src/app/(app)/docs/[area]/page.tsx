import type { Metadata } from "next";
import { Lock, Pin, Plus, Trash2 } from "lucide-react";
import { Badge, Card, CardLink, EmptyState, NavLink, PageHeader } from "@/components/ui/layout";
import { Disclosure } from "@/components/ui/disclosure";
import { SearchInput } from "@/components/ui/form";
import { ConfirmSubmitButton, LinkButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
import { db } from "@/server/db";
import { contains } from "@/server/search";
import { requireDocArea, visibleChapters, visiblePages } from "@/capabilities/docs/access";
import { deleteDocCategory } from "@/capabilities/docs/actions";
import { CategoryForm } from "@/capabilities/docs/category-form";

export async function generateMetadata({ params }: { params: Promise<{ area: string }> }): Promise<Metadata> {
  const { area } = await params;
  const { t, has } = await getI18n();
  return { title: has(`docs.areas.${area}.title`) ? t(`docs.areas.${area}.title` as never) : t("nav.handbook") };
}

/** Markdown-Zeichen entfernen und kürzen – für die Vorschau in der Liste. */
function snippet(md: string, max = 150) {
  const text = md.replace(/```[\s\S]*?```/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#>*_`|~-]+/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()} …` : text;
}

export default async function DocsIndexPage({ params, searchParams }: { params: Promise<{ area: string }>; searchParams: Promise<{ q?: string; cat?: string }> }) {
  const [{ area: areaParam }, sp] = await Promise.all([params, searchParams]);
  const { area, session, canEdit } = await requireDocArea(areaParam);
  const { t, tp, date } = await getI18n();
  const q = (sp.q ?? "").trim();

  const [categories, pages, roles] = await Promise.all([
    db.docCategory.findMany({
      where: { area, ...visibleChapters(session, area) },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { pages: true } }, roles: { select: { roleId: true } } },
    }),
    db.docPage.findMany({
      where: {
        area,
        AND: [
          visiblePages(session, area),
          sp.cat === "none" ? { categoryId: null } : sp.cat ? { categoryId: sp.cat } : {},
          q ? { OR: [{ title: contains(q) }, { content: contains(q) }] } : {},
        ],
      },
      include: { category: true },
      orderBy: [{ pinned: "desc" }, { title: "asc" }],
    }),
    // Administratoren sehen ohnehin alles – nur die übrigen Rollen lassen sich für ein Kapitel auswählen
    canEdit ? db.role.findMany({ where: { isAdmin: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
  ]);
  const total = categories.reduce((n, c) => n + c._count.pages, 0);
  const base = `/docs/${area}`;

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
          <NavLink href={base} active={!sp.cat}>
            {t("docs.allPages")}
          </NavLink>
          {categories.map((c) => (
            <NavLink
              key={c.id}
              href={`${base}?cat=${c.id}`}
              active={sp.cat === c.id}
              count={c._count.pages}
              icon={c.roles.length > 0 ? <Lock className="size-3.5 shrink-0" aria-label={t("docs.restricted")} /> : undefined}
            >
              {c.name}
            </NavLink>
          ))}
          <NavLink href={`${base}?cat=none`} active={sp.cat === "none"}>
            {t("docs.noCategory")}
          </NavLink>
          {canEdit ? (
            <Disclosure title={t("docs.manageCategories")} className="mt-3">
              <ul className="mt-2 flex flex-col gap-3">
                {categories.map((c) => (
                  <li key={c.id} className="flex items-start gap-1.5">
                    <div className="min-w-0 flex-1">
                      <CategoryForm area={area} roles={roles} initial={{ id: c.id, name: c.name, sortOrder: c.sortOrder, roleIds: c.roles.map((r) => r.roleId) }} />
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
                <CategoryForm area={area} roles={roles} />
              </div>
            </Disclosure>
          ) : null}
          <p className="mt-2 px-3 text-xs text-ink-muted">{tp("docs.count", total)}</p>
        </aside>

        <div className="min-w-0">
          <form method="get" role="search" className="mb-4">
            {sp.cat ? <input type="hidden" name="cat" value={sp.cat} /> : null}
            <SearchInput name="q" defaultValue={q} placeholder={t("docs.searchPlaceholder")} aria-label={t("common.search")} />
          </form>

          {pages.length === 0 ? (
            <Card as="div" padded={false}>
              <EmptyState title={q ? t("common.noResults") : t("docs.empty")} hint={q ? undefined : t("docs.emptyHint")} action={canEdit && !q ? <LinkButton href={`${base}/new`} variant="primary">{t("docs.new")}</LinkButton> : undefined} />
            </Card>
          ) : (
            <ul className="flex flex-col gap-3">
              {pages.map((p) => (
                <li key={p.id}>
                  <CardLink href={`${base}/${p.slug}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      {p.pinned ? <Pin className="size-4 text-accent-text" aria-label={t("docs.pinned")} /> : null}
                      <h2 className="font-semibold">{p.title}</h2>
                      {p.category ? <Badge>{p.category.name}</Badge> : null}
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{snippet(p.content)}</p>
                    <p className="mt-2 text-xs text-ink-muted">
                      {t("docs.updated", { date: date(p.updatedAt), who: p.updatedByName ?? "–" })}
                    </p>
                  </CardLink>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
