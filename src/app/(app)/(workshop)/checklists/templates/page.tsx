import type { Metadata } from "next";
import { Plus, WandSparkles } from "lucide-react";
import { LinkButton, SubmitButton } from "@/components/ui/buttons";
import { DataTable } from "@/components/ui/data-table";
import { Alert, EmptyState, StatusBadge } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { archiveTemplate, installDefaults } from "@/modules/workshop/checklists/actions";
import { STANDARD_KEYS } from "@/modules/workshop/checklists/constants";
import { listTemplates } from "@/modules/workshop/checklists/queries";
import { requirePermission } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("checklists.templates.title") };
}

/** Vorlagen verwalten (Leitung): aktive und archivierte Vorlagen mit Version und Punktzahl; bearbeiten erzeugt eine neue Version. Fehlen mitgelieferte Vorlagen, bietet die Seite an, sie einzurichten. */
export default async function TemplatesPage() {
  const session = await requirePermission("checklists.manage");
  const { t, td } = await getI18n();
  const rows = await listTemplates(session, { includeArchived: true });
  const missingDefaults = STANDARD_KEYS.some((key) => !rows.some((r) => r.standardKey === key));

  return (
    <>
      <PageHeader
        back={{ href: "/checklists", label: t("nav.checklists") }}
        help="workshop.checklists"
        title={t("checklists.templates.title")}
        description={t("checklists.templates.description")}
        actions={
          <LinkButton href="/checklists/templates/new" variant="primary">
            <Plus className="size-4" aria-hidden /> {t("checklists.templates.new")}
          </LinkButton>
        }
      />
      {missingDefaults ? (
        <Alert tone="info" className="mb-5">
          <p className="mb-3">{t("checklists.templates.installHint")}</p>
          <form action={installDefaults}>
            <SubmitButton variant="secondary">
              <WandSparkles className="size-4" aria-hidden /> {t("checklists.templates.installDefaults")}
            </SubmitButton>
          </form>
        </Alert>
      ) : null}
      <DataTable
        caption={t("checklists.templates.title")}
        rows={rows}
        rowKey={(r) => r.id}
        rowHref={(r) => `/checklists/templates/${r.id}`}
        minWidth="44rem"
        empty={<EmptyState title={t("checklists.templates.empty")} />}
        columns={[
          { id: "name", header: t("checklists.templates.cols.name"), priority: "primary", cell: (r) => <span className="font-medium">{r.name}</span>, sub: (r) => (r.standardKey ? t("checklists.templates.standard") : null) },
          { id: "version", header: t("checklists.templates.cols.version"), cell: (r) => <span className="tabular">v{r.version}</span> },
          { id: "items", header: t("checklists.templates.cols.items"), align: "end", cell: (r) => <span className="tabular">{r.itemCount}</span> },
          { id: "signature", header: t("checklists.templates.cols.signature"), priority: "low", cell: (r) => td(`checklists.signatureModes.${r.signatureMode}`, r.signatureMode) },
          { id: "state", header: t("checklists.templates.cols.state"), cell: (r) => <StatusBadge tone={r.archived ? "neutral" : "success"}>{r.archived ? t("checklists.templates.archived") : t("checklists.templates.active")}</StatusBadge> },
          {
            id: "actions",
            header: t("common.actions"),
            hideHeader: true,
            cell: (r) => (
              <form action={archiveTemplate}>
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="archived" value={r.archived ? "0" : "1"} />
                <SubmitButton variant="ghost" size="sm">
                  {r.archived ? t("checklists.templates.unarchive") : t("checklists.templates.archive")}
                </SubmitButton>
              </form>
            ),
          },
        ]}
      />
    </>
  );
}
