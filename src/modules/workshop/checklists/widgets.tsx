import Link from "next/link";
import { Card, EmptyState, Plate, StatusBadge, TextLink } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import type { WidgetDef } from "@/modules/types";
import { getSession } from "@/server/auth/session";
import { openChecklists, statusCounts } from "./queries";

/** Baustein „Offene Checklisten“: die ältesten offenen Checklisten (Vorlage, Kennzeichen, Fortschritt) – wer sie sehen darf, nach den Rechten für Fahrzeug bzw. Auftrag. */
export async function OpenChecklistsWidget() {
  const session = await getSession();
  if (!session) return null;
  const [{ t, tp }, counts, rows] = await Promise.all([getI18n(), statusCounts(session), openChecklists(session, 5)]);
  return (
    <Card
      headingLevel={3}
      title={t("checklists.widgets.openTitle")}
      actions={
        <TextLink href="/checklists" className="text-sm">
          {t("common.showAll")}
        </TextLink>
      }
      padded={false}
    >
      {counts.open === 0 ? (
        <EmptyState title={t("checklists.widgets.empty")} />
      ) : (
        <>
          <p className="px-5 pt-3 text-sm text-ink-muted">{tp("checklists.widgets.count", counts.open)}</p>
          <ul className="divide-y divide-line">
            {rows.map((c) => (
              <li key={c.id}>
                <Link href={`/checklists/${c.id}`} className="flex min-h-(--tap-row) items-center justify-between gap-3 px-5 py-3 hover:bg-surface-hover">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Plate>{c.plate}</Plate>
                      <span className="truncate text-sm">{c.templateName}</span>
                    </div>
                    {c.orderNumber ? <p className="mt-0.5 truncate text-xs text-ink-muted">{c.orderNumber}</p> : null}
                  </div>
                  <StatusBadge tone={c.requiredOpen === 0 ? "success" : "info"}>{t("checklists.progressText", { done: c.progress.done, total: c.progress.total })}</StatusBadge>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

export const widgets: WidgetDef[] = [
  { id: "checklists-open", titleKey: "checklists.widgets.openTitle", priority: 21, feature: "workshop.checklists", permission: "checklists.view", span: 1, order: 16, Component: OpenChecklistsWidget },
];
