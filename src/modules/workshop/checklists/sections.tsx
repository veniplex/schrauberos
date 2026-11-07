import { ClipboardCheck, ListPlus } from "lucide-react";
import { Button, LinkButton } from "@/components/ui/buttons";
import { Card, StatusBadge, TextLink } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import type { SectionDef, SectionProps } from "@/modules/types";
import { orderRef } from "@/modules/workshop/orders/public";
import { vehicleRef } from "@/modules/workshop/vehicles/public";
import { startChecklist } from "./actions";
import { checklistsOf, listTemplates } from "./queries";

/**
 * Beitrag zur Auftrags- und zur Fahrzeugseite: „Checklisten“ mit den vorhandenen Checklisten (Stand und Fortschritt), dem Knopf **„Annahmeprotokoll starten“** am Auftrag (Host-Beitrag: Aufträge kennen die Funktion
 * nicht; der Annahme-Status erscheint auch nicht in der Auftragsliste) und „Weitere Checkliste beginnen“. Bei einem Kunden mit eingeschränkter Verarbeitung (Art. 18) erscheint der Abschnitt gar nicht.
 */
async function ChecklistsSection({ entityId, session, type }: SectionProps & { type: "vehicle" | "order" }) {
  const [{ t, date }, rows, templates] = await Promise.all([getI18n(), checklistsOf(session, { type, id: entityId }), listTemplates(session)]);
  let open: boolean;
  if (type === "order") {
    const ref = await orderRef(entityId);
    if (!ref || ref.restricted) return null;
    open = ref.open;
  } else {
    const ref = await vehicleRef(entityId);
    if (!ref || ref.restricted) return null;
    open = !ref.archived;
  }
  const canStart = open && session.can("checklists.fill");
  const intake = templates.find((tpl) => tpl.standardKey === "intake");
  const intakeRow = type === "order" ? rows.find((c) => c.standardKey === "intake" && c.status !== "discarded") : undefined;
  const newHref = type === "order" ? `/checklists/new?order=${entityId}` : `/checklists/new?vehicle=${entityId}`;

  return (
    <Card title={t("checklists.section.title")}>
      {!open ? <p className="mb-4 text-sm text-ink-muted">{type === "order" ? t("checklists.section.orderClosed") : t("checklists.section.vehicleArchived")}</p> : null}
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("checklists.section.empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line text-sm">
          {rows.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <TextLink href={`/checklists/${c.id}`} className="font-medium">
                  {c.templateName}
                </TextLink>
                <p className="text-xs text-ink-muted">
                  {date(c.createdAt, { dateStyle: "medium" })} · {c.createdByName}
                </p>
              </div>
              <span className="flex items-center gap-2">
                <span className="tabular text-xs text-ink-muted">{t("checklists.progressText", { done: c.progress.done, total: c.progress.total })}</span>
                <StatusBadge tone={c.status === "completed" ? "success" : "info"}>{t(`checklists.status.${c.status}`)}</StatusBadge>
              </span>
            </li>
          ))}
        </ul>
      )}
      {canStart ? (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
          {type === "order" && intake && !intakeRow ? (
            <form action={startChecklist}>
              <input type="hidden" name="templateId" value={intake.id} />
              <input type="hidden" name="orderId" value={entityId} />
              <Button type="submit" variant="primary">
                <ClipboardCheck className="size-4" aria-hidden /> {t("checklists.section.startIntake")}
              </Button>
            </form>
          ) : intakeRow && intakeRow.status === "open" ? (
            <LinkButton href={`/checklists/${intakeRow.id}`} variant="primary">
              <ClipboardCheck className="size-4" aria-hidden /> {t("checklists.section.intakeOpen")}
            </LinkButton>
          ) : null}
          <LinkButton href={newHref} variant="secondary">
            <ListPlus className="size-4" aria-hidden /> {t("checklists.section.start")}
          </LinkButton>
        </div>
      ) : null}
    </Card>
  );
}

export const sections: SectionDef[] = [
  { id: "checklists-order", feature: "workshop.checklists", host: "orders/detail", permission: "checklists.view", order: 50, uses: ["workshop.orders"], Component: (props: SectionProps) => <ChecklistsSection {...props} type="order" /> },
  { id: "checklists-vehicle", feature: "workshop.checklists", host: "vehicles/detail", permission: "checklists.view", order: 50, Component: (props: SectionProps) => <ChecklistsSection {...props} type="vehicle" /> },
];
