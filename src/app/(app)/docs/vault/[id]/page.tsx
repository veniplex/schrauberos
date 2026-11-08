import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { LinkButton } from "@/components/ui/buttons";
import { Field, Input } from "@/components/ui/form";
import { Alert, Badge, Card, DangerZone, DefinitionList, StatusBadge } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { deleteVaultEntry } from "@/modules/it/docs/vault-actions";
import { VAULT_STATE_TONE } from "@/modules/it/docs/status-tone";
import { getVaultEntry, vaultTitle } from "@/modules/it/docs/vault-queries";
import { VaultReveal } from "@/modules/it/docs/vault-reveal";
import { requirePermission, sessionIfAllowed } from "@/server/auth/session";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!(await sessionIfAllowed("docsIt.vault"))) return {};
  return { title: (await vaultTitle(id)) ?? undefined };
}

/** Eintrag des IT-Tresors: Titel, Art, System, Zustand. Die Zugangsdaten erscheinen nur nach „Anzeigen“ mit erneuter Passwortabfrage (`VaultReveal`) – diese Seite liest sie nie. */
export default async function VaultEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("docsIt.vault");
  const { id } = await params;
  const { t, date } = await getI18n();
  const entry = await getVaultEntry(id);
  if (!entry) notFound();
  const canManage = session.can("docsIt.vaultManage");
  const when = (d: Date) => date(d, { dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <PageHeader
        back={{ href: "/docs/vault", label: t("vault.title") }}
        help="it.vault"
        title={entry.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge>{t(`vault.kind.${entry.kind}`)}</Badge>
            <StatusBadge tone={VAULT_STATE_TONE[entry.state]}>{t(`vault.state.${entry.state}`)}</StatusBadge>
          </span>
        }
        actions={
          canManage ? (
            <LinkButton href={`/docs/vault/${entry.id}/edit`}>
              <Pencil className="size-4" aria-hidden /> {t("common.edit")}
            </LinkButton>
          ) : null
        }
      />
      <div className="flex max-w-3xl flex-col gap-5">
        {entry.state === "unreadable" ? <Alert tone="warning">{t("vault.unreadableNotice")}</Alert> : null}
        {entry.state === "empty" ? <Alert tone="info">{t("vault.emptyNotice")}</Alert> : null}

        {entry.state === "sealed" ? <VaultReveal id={entry.id} /> : null}

        <Card title={t("vault.sections.entry")}>
          <DefinitionList
            items={[
              { label: t("vault.fields.system"), value: entry.system },
              { label: t("vault.fields.kind"), value: t(`vault.kind.${entry.kind}`) },
              { label: t("vault.cols.changed"), value: `${when(entry.updatedAt)}${entry.updatedByName ? ` · ${entry.updatedByName}` : ""}` },
              { label: t("vault.fields.created"), value: `${when(entry.createdAt)}${entry.createdByName ? ` · ${entry.createdByName}` : ""}` },
            ]}
          />
        </Card>

        {canManage ? (
          <DangerZone title={t("common.dangerZone")}>
            <form action={deleteVaultEntry} className="flex max-w-sm flex-col gap-3">
              <input type="hidden" name="id" value={entry.id} />
              <Field label={t("vault.fields.password")} htmlFor="vault-delete-password" required hint={t("vault.fields.deleteHint")}>
                <Input id="vault-delete-password" name="password" type="password" required autoComplete="current-password" data-no-draft />
              </Field>
              <ConfirmSubmitButton message={t("vault.deleteConfirm", { title: entry.title })}>{t("vault.delete")}</ConfirmSubmitButton>
            </form>
          </DangerZone>
        ) : null}
      </div>
    </>
  );
}
