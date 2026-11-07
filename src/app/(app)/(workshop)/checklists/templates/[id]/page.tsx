import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, StatusBadge } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { TemplateEditor } from "@/modules/workshop/checklists/template-editor";
import { getTemplate } from "@/modules/workshop/checklists/queries";
import { requirePermission, sessionIfAllowed } from "@/server/auth/session";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { t } = await getI18n();
  const session = await sessionIfAllowed("checklists.manage");
  if (!session) return {};
  const template = await getTemplate(session, (await params).id);
  return { title: template ? template.name : t("checklists.templates.edit") };
}

/** Vorlage bearbeiten: Editor (speichert eine neue Version) und der Versionsverlauf mit Anmerkung, Person und Zahl der Checklisten, die diese Version benutzen. */
export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("checklists.manage");
  const [{ id }, { t, tp, date }] = await Promise.all([params, getI18n()]);
  const template = await getTemplate(session, id);
  if (!template) notFound();

  return (
    <>
      <PageHeader
        back={{ href: "/checklists/templates", label: t("checklists.templates.title") }}
        help="workshop.checklists"
        title={template.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="tabular">v{template.version}</span>
            {template.archived ? <StatusBadge tone="neutral">{t("checklists.templates.archived")}</StatusBadge> : null}
          </span>
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <TemplateEditor
            initial={{
              id: template.id,
              version: template.versionToken,
              name: template.name,
              description: template.description ?? "",
              signatureMode: template.signatureMode,
              archived: template.archived,
              items: template.items.map((i) => ({
                label: i.label,
                type: (["check", "measure", "torque", "choice", "text", "photo"].includes(i.type) ? i.type : "check") as "check",
                required: i.required,
                unit: i.unit ?? "",
                minValue: i.minValue === null ? "" : String(i.minValue),
                maxValue: i.maxValue === null ? "" : String(i.maxValue),
                targetValue: i.targetValue === null ? "" : String(i.targetValue),
                options: i.options ?? "",
                hint: i.hint ?? "",
              })),
            }}
          />
        </div>
        <Card title={t("checklists.templates.versions.title")} className="h-fit">
          <ol className="flex flex-col gap-3 text-sm">
            {template.versions.map((v, index) => (
              <li key={v.version} className="rounded-md border border-line p-3">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {t("checklists.templates.versions.version", { version: v.version })}
                  {index === 0 ? <StatusBadge tone="success">{t("checklists.templates.versions.current")}</StatusBadge> : null}
                </p>
                <p className="text-xs text-ink-muted">{t("checklists.templates.versions.by", { name: v.createdByName, time: date(v.createdAt, { dateStyle: "medium", timeStyle: "short" }) })}</p>
                {v.note ? <p className="mt-1 whitespace-pre-line break-words">{v.note}</p> : null}
                <p className="mt-1 text-xs text-ink-muted">
                  {tp("checklists.templates.versions.items", v.itemCount)} · {tp("checklists.templates.versions.usedBy", v.checklists)}
                </p>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
