import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/layout";
import { ConfirmSubmitButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
import { db } from "@/server/db";
import { requireDocArea, visiblePages } from "@/capabilities/docs/access";
import { restoreDocVersion } from "@/capabilities/docs/actions";
import { Markdown } from "@/components/ui/markdown";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("docs.history") };
}

export default async function DocHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ area: string; slug: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const [{ area: areaParam, slug }, sp] = await Promise.all([params, searchParams]);
  const { area, session, canEdit } = await requireDocArea(areaParam);
  const { t, date } = await getI18n();

  // Seiten in Kapiteln, die der Benutzer nicht lesen darf, gibt es für ihn nicht
  const page = await db.docPage.findFirst({
    where: { area, slug, ...visiblePages(session, area) },
    include: { versions: { orderBy: { savedAt: "desc" } } },
  });
  if (!page) notFound();
  const base = `/docs/${area}/${page.slug}`;
  const selected = page.versions.find((v) => v.id === sp.v);

  return (
    <>
      <PageHeader
        title={t("docs.history")}
        description={
          <Link href={base} className="text-accent-text hover:underline">
            {page.title}
          </Link>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <Card title={t("docs.versions", { count: page.versions.length })} padded={false}>
          {page.versions.length === 0 ? (
            <EmptyState title={t("docs.noVersions")} />
          ) : (
            <ul className="divide-y divide-line">
              {page.versions.map((v, i) => (
                <li key={v.id} className={`flex items-center justify-between gap-3 px-5 py-3 text-sm ${selected?.id === v.id ? "bg-accent-subtle" : ""}`}>
                  <Link href={`${base}/history?v=${v.id}`} className="min-w-0 hover:underline">
                    <span className="block tabular font-medium">{date(v.savedAt, { dateStyle: "medium", timeStyle: "short" })}</span>
                    <span className="block truncate text-xs text-ink-muted">{v.savedByName ?? "–"}</span>
                  </Link>
                  {i === 0 ? <Badge tone="accent">{t("docs.current")}</Badge> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="min-w-0">
          {selected ? (
            <Card
              title={selected.title}
              actions={
                canEdit && selected.id !== page.versions[0]?.id ? (
                  <form action={restoreDocVersion}>
                    <input type="hidden" name="area" value={area} />
                    <input type="hidden" name="versionId" value={selected.id} />
                    <ConfirmSubmitButton message={t("docs.restoreConfirm")} variant="secondary">
                      {t("docs.restore")}
                    </ConfirmSubmitButton>
                  </form>
                ) : null
              }
            >
              {selected.content.trim() ? <Markdown source={selected.content} /> : <p className="text-sm text-ink-muted">{t("docs.emptyPage")}</p>}
            </Card>
          ) : (
            <Card as="div" padded={false}>
              <EmptyState title={t("docs.pickVersion")} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
