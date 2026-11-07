import Link from "next/link";
import { Pin } from "lucide-react";
import { Card, EmptyState, TextLink } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { requireSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { visiblePages } from "./access";
import type { DocArea } from "./areas";

/** Angeheftete Seiten eines Bereichs (z. B. Notfall-Checklisten) direkt auf der Übersicht – nur aus Kapiteln, die der Benutzer lesen darf. */
export async function PinnedDocs({ area }: { area: DocArea }) {
  const [{ t }, session] = await Promise.all([getI18n(), requireSession()]);
  const pages = await db.docPage.findMany({
    where: { area, pinned: true, ...visiblePages(session, area) },
    orderBy: { title: "asc" },
    take: 8,
    select: { id: true, slug: true, title: true },
  });

  return (
    <Card headingLevel={3} title={t(`docs.areas.${area}.title`)} actions={<TextLink href={`/docs/${area}`} className="text-sm">{t("common.showAll")}</TextLink>} padded={false}>
      {pages.length === 0 ? (
        <EmptyState title={t("docs.widgets.nonePinned")} hint={t("docs.widgets.pinHint")} />
      ) : (
        <ul className="divide-y divide-line">
          {pages.map((p) => (
            <li key={p.id}>
              <Link href={`/docs/${area}/${p.slug}`} className="flex min-h-(--tap-row) items-center gap-2 px-5 py-2.5 text-sm hover:bg-surface-hover">
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
