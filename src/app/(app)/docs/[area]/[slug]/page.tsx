import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { History, Pencil, Pin, PinOff } from "lucide-react";
import { Badge, Card, PageHeader } from "@/components/ui/layout";
import { LinkButton, SubmitButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
import { markdownHeadings } from "@/lib/slug";
import { db } from "@/server/db";
import { requireDocArea, visiblePages } from "@/capabilities/docs/access";
import { isDocArea } from "@/capabilities/docs/areas";
import { getSession } from "@/server/auth/session";
import { togglePin } from "@/capabilities/docs/actions";
import { Markdown } from "@/components/ui/markdown";

export async function generateMetadata({ params }: { params: Promise<{ area: string; slug: string }> }): Promise<Metadata> {
  const { area, slug } = await params;
  const session = await getSession();
  if (!session || !isDocArea(area)) return {};
  const page = await db.docPage.findFirst({ where: { area, slug, ...visiblePages(session, area) }, select: { title: true } });
  return { title: page?.title };
}

export default async function DocPage({ params }: { params: Promise<{ area: string; slug: string }> }) {
  const { area: areaParam, slug } = await params;
  const { area, session, canEdit } = await requireDocArea(areaParam);
  const { t, date } = await getI18n();

  const page = await db.docPage.findFirst({ where: { area, slug, ...visiblePages(session, area) }, include: { category: true } });
  if (!page) notFound();
  const toc = markdownHeadings(page.content);
  const base = `/docs/${area}`;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {page.pinned ? <Pin className="size-5 text-accent-text" aria-label={t("docs.pinned")} /> : null}
            {page.title}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={base} className="text-accent-text inline-flex min-h-(--tap-row) min-w-(--tap-row) items-center hover:underline">
              {t(`docs.areas.${area}.title`)}
            </Link>
            {page.category ? <Badge>{page.category.name}</Badge> : null}
            <span>{t("docs.updated", { date: date(page.updatedAt), who: page.updatedByName ?? "–" })}</span>
          </span>
        }
        actions={
          <>
            <LinkButton href={`${base}/${page.slug}/history`}>
              <History className="size-4" aria-hidden /> {t("docs.history")}
            </LinkButton>
            {canEdit ? (
              <>
                <form action={togglePin}>
                  <input type="hidden" name="area" value={area} />
                  <input type="hidden" name="id" value={page.id} />
                  <SubmitButton variant="secondary">
                    {page.pinned ? <PinOff className="size-4" aria-hidden /> : <Pin className="size-4" aria-hidden />}
                    {page.pinned ? t("docs.unpin") : t("docs.pin")}
                  </SubmitButton>
                </form>
                <LinkButton href={`${base}/${page.slug}/edit`} variant="primary">
                  <Pencil className="size-4" aria-hidden /> {t("common.edit")}
                </LinkButton>
              </>
            ) : null}
          </>
        }
      />

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_14rem]">
        <Card as="article" className="min-w-0">
          {page.content.trim() ? <Markdown source={page.content} /> : <p className="text-sm text-ink-muted">{t("docs.emptyPage")}</p>}
        </Card>
        {toc.length > 1 ? (
          <nav aria-label={t("docs.toc")} className="hidden xl:block">
            <div className="sticky top-20">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t("docs.toc")}</p>
              <ul className="flex flex-col gap-1 border-l border-line text-sm">
                {toc.map((h, i) => (
                  <li key={`${h.id}-${i}`}>
                    <a href={`#${h.id}`} className={`block py-0.5 text-ink-muted hover:text-ink ${h.level === 3 ? "pl-6" : "pl-3"}`}>
                      {h.text}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
        ) : null}
      </div>
    </>
  );
}
