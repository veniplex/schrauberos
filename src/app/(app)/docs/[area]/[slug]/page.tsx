import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { History, Pencil, Pin, PinOff } from "lucide-react";
import { Badge, Card } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton, SubmitButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
import { markdownHeadings } from "@/lib/slug";
import { db } from "@/server/db";
import { requireDocArea, visiblePages } from "@/capabilities/docs/access";
import { DOC_PERMISSIONS, isDocArea } from "@/capabilities/docs/areas";
import { sessionIfAllowed } from "@/server/auth/session";
import { togglePin } from "@/capabilities/docs/actions";
import { Markdown } from "@/components/ui/markdown";
import { PageToc } from "@/components/ui/toc";

export async function generateMetadata({ params }: { params: Promise<{ area: string; slug: string }> }): Promise<Metadata> {
  const { area, slug } = await params;
  // Der Titel einer Seite steht sonst schon im ersten gestreamten HTML, bevor die Seite selbst ihr Recht prüft: nur mit dem Leserecht des Bereichs (ZP5-13)
  if (!isDocArea(area)) return {};
  const session = await sessionIfAllowed(DOC_PERMISSIONS[area].view);
  if (!session) return {};
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
        back={{ href: base, label: t(`docs.areas.${area}.title`) }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {page.pinned ? <Pin className="size-5 text-accent-text" aria-label={t("docs.pinned")} /> : null}
            {page.title}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
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

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_14rem]">
        <Card as="article" className="min-w-0">
          {toc.length > 1 ? <PageToc title={t("docs.toc")} items={toc} placement="inline" /> : null}
          {page.content.trim() ? <Markdown source={page.content} taskLabels={{ done: t("common.taskDone"), open: t("common.taskOpen") }} /> : <p className="text-sm text-ink-muted">{t("docs.emptyPage")}</p>}
        </Card>
        {toc.length > 1 ? <PageToc title={t("docs.toc")} items={toc} placement="aside" /> : null}
      </div>
    </>
  );
}
