import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert, Card, DefinitionList, Plate, StatusBadge, TextLink } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { Timeline, type TimelineItem } from "@/components/ui/timeline";
import { getI18n } from "@/i18n/server";
import { ChecklistRunner, ReopenForm, type RunnerItem } from "@/modules/workshop/checklists/checklist-runner";
import type { ChecklistStatus } from "@/modules/workshop/checklists/constants";
import { getChecklist } from "@/modules/workshop/checklists/queries";
import { requirePermission, sessionIfAllowed } from "@/server/auth/session";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { t } = await getI18n();
  const session = await sessionIfAllowed("checklists.view");
  if (!session) return {};
  const { id } = await params;
  const checklist = await getChecklist(session, id);
  return { title: checklist ? `${checklist.templateName} · ${checklist.plate}` : t("checklists.title") };
}

const TONE: Record<ChecklistStatus, "info" | "success" | "neutral"> = { open: "info", completed: "success", discarded: "neutral" };

/**
 * Eine Checkliste: oben der Stand, darunter die Punkte (jeder speichert für sich), bei offener Checkliste das Abschließen mit Kundenunterschrift, bei abgeschlossener die Unterschrift und – für die Leitung – das
 * Wiederöffnen mit Begründung; rechts Fahrzeug, Auftrag und der Verlauf. Eine Checkliste, die die Person nach den Rechten für Fahrzeug bzw. Auftrag nicht sehen darf (oder von einem Kunden mit
 * eingeschränkter Verarbeitung), gibt es nicht (404).
 */
export default async function ChecklistPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("checklists.view");
  const [{ id }, { t, td, date }] = await Promise.all([params, getI18n()]);
  const checklist = await getChecklist(session, id);
  if (!checklist) notFound();

  const open = checklist.status === "open";
  const editable = open && checklist.ownerOpen && session.can("checklists.fill");
  const items: RunnerItem[] = checklist.items.map((i) => ({
    id: i.id,
    label: i.label,
    type: i.type,
    unit: i.unit,
    minValue: i.minValue,
    maxValue: i.maxValue,
    targetValue: i.targetValue,
    options: i.options ? i.options.split(/\r?\n/).filter(Boolean) : [],
    required: i.required,
    hint: i.hint,
    done: i.done,
    numberValue: i.numberValue,
    textValue: i.textValue,
    doneLabel: i.doneByName && i.doneAt ? t("checklists.detail.doneBy", { name: i.doneByName, time: date(i.doneAt, { dateStyle: "medium", timeStyle: "short" }) }) : null,
    version: i.version,
  }));
  const timeline: TimelineItem[] = checklist.events.map((e) => ({
    id: e.id,
    title: td(`checklists.events.${e.kind}`, e.kind),
    description: [e.byName, e.kind === "reopened" ? e.note : null].filter(Boolean).join(" · "),
    time: date(e.at, { dateStyle: "medium", timeStyle: "short" }),
    tone: e.kind === "reopened" ? "warning" : e.kind === "completed" ? "success" : "neutral",
  }));

  return (
    <>
      <PageHeader
        back={{ href: "/checklists", label: t("nav.checklists") }}
        help="workshop.checklists"
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Plate>{checklist.plate}</Plate>
            <span>{checklist.templateName}</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={TONE[checklist.status]}>{t(`checklists.status.${checklist.status}`)}</StatusBadge>
            <span>{t("checklists.detail.template", { name: checklist.templateName, version: checklist.templateVersion })}</span>
          </span>
        }
      />

      {checklist.status === "completed" ? <Alert tone="success" className="mb-5">{t("checklists.detail.lockedNote")}</Alert> : null}
      {checklist.status === "discarded" ? <Alert tone="info" className="mb-5">{t("checklists.detail.discardedNote")}</Alert> : null}
      {open && !checklist.ownerOpen ? <Alert tone="warning" className="mb-5">{t("checklists.detail.orderClosedNote")}</Alert> : null}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-5 md:col-span-2">
          <ChecklistRunner
            id={checklist.id}
            version={checklist.version}
            items={items}
            editable={editable}
            canFill={session.can("checklists.fill")}
            canDiscard={session.can("checklists.fill") && (checklist.createdById === session.user.id || session.can("checklists.manage"))}
            signatureMode={checklist.signatureMode}
          />

          {checklist.status === "completed" ? (
            <Card title={t("checklists.detail.signature")}>
              <div className="flex flex-col gap-2 text-sm">
                {checklist.hasSignatureImage ? (
                  <>
                    <p>{t("checklists.detail.signedBy", { name: checklist.customerName ?? "–" })}</p>
                    <p>
                      <TextLink href={`/api/checklists/${checklist.id}/signature`} external target="_blank" rel="noopener">
                        {t("checklists.detail.viewSignature")}
                      </TextLink>
                    </p>
                  </>
                ) : checklist.signedName ? (
                  <p>{t("checklists.detail.typedBy", { name: checklist.signedName })}</p>
                ) : (
                  <p className="text-ink-muted">{t("checklists.detail.noSignature")}</p>
                )}
                {checklist.note ? <p className="whitespace-pre-line">{checklist.note}</p> : null}
                {checklist.completedAt && checklist.completedByName ? <p className="text-xs text-ink-muted">{t("checklists.detail.completedBy", { name: checklist.completedByName, time: date(checklist.completedAt, { dateStyle: "medium", timeStyle: "short" }) })}</p> : null}
              </div>
            </Card>
          ) : null}

          {checklist.status === "completed" && checklist.ownerOpen && session.can("checklists.reopen") ? <ReopenForm id={checklist.id} version={checklist.version} /> : null}
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Card title={t("checklists.detail.vehicle")}>
            <DefinitionList
              items={[
                { label: t("checklists.detail.vehicle"), value: session.can("vehicles.view") ? <TextLink href={`/vehicles/${checklist.vehicleId}`}>{[checklist.plate, checklist.vehicleName].filter(Boolean).join(" · ")}</TextLink> : checklist.plate },
                {
                  label: t("checklists.detail.order"),
                  value: checklist.orderId && checklist.orderNumber ? (session.can("orders.view") ? <TextLink href={`/orders/${checklist.orderId}`}>{checklist.orderNumber}</TextLink> : checklist.orderNumber) : null,
                },
              ]}
            />
          </Card>
          <Card title={t("checklists.detail.history")}>
            <Timeline items={timeline} label={t("checklists.detail.history")} />
          </Card>
        </div>
      </div>
    </>
  );
}
