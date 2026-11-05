import Link from "next/link";
import { Pin } from "lucide-react";
import { Card, EmptyState } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { db } from "@/server/db";
import type { DocArea } from "./areas";

/** Angeheftete Dokumentationsseiten eines Bereichs (z. B. Notfall-Checklisten) direkt auf der Übersicht. */
async function PinnedDocs({ area }: { area: DocArea }) {
  const { t } = await getI18n();
  const pages = await db.docPage.findMany({ where: { area, pinned: true }, orderBy: { title: "asc" }, take: 8, select: { id: true, slug: true, title: true } });

  return (
    <Card title={t(`docs.areas.${area}.title`)} actions={<Link href={`/docs/${area}`} className="text-sm text-accent-text hover:underline">{t("common.showAll")}</Link>} padded={false}>
      {pages.length === 0 ? (
        <EmptyState title={t("docs.widgets.nonePinned")} hint={t("docs.widgets.pinHint")} />
      ) : (
        <ul className="divide-y divide-line">
          {pages.map((p) => (
            <li key={p.id}>
              <Link href={`/docs/${area}/${p.slug}`} className="flex items-center gap-2 px-5 py-2.5 text-sm hover:bg-surface-hover">
                <Pin className="size-3.5 shrink-0 text-accent-text" aria-hidden />
                <span className="truncate font-medium">{p.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export const PinnedWorkshopDocs = () => <PinnedDocs area="workshop" />;
export const PinnedOfficeDocs = () => <PinnedDocs area="office" />;
export const PinnedItDocs = () => <PinnedDocs area="it" />;
