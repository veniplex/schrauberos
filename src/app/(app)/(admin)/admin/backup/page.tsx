import type { Metadata } from "next";
import { Download, Trash2 } from "lucide-react";
import { Alert, Badge, Card, EmptyState, PageHeader, Table } from "@/components/ui/layout";
import { ConfirmSubmitButton, LinkButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
import { readPending, readRestoreResult } from "@/lib/updates/restore";
import { requirePermission } from "@/server/auth/session";
import { listBackups } from "@/server/backup/core";
import { getBackupSettings } from "@/server/backup/settings";
import { removeBackup } from "@/modules/admin/backup/actions";
import { CreateBackupForm, RestoreForm, RestoreWatcher, UploadForm } from "@/modules/admin/backup/panels";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("backup.title") };
}

const KIND_TONE = { auto: "info", manual: "accent", upload: "neutral", "pre-update": "warning", "pre-restore": "warning", "pre-migration": "warning" } as const;

function size(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default async function BackupPage() {
  await requirePermission("backup.manage");
  const { t, td, date } = await getI18n();
  const [settings, backups] = [await getBackupSettings(), listBackups()];
  const pending = readPending();
  const result = readRestoreResult();
  const when = (d: Date | string) => date(d, { dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <PageHeader title={t("backup.title")} description={t("backup.description")} />
      <div className="flex max-w-4xl flex-col gap-5">
        {pending ? (
          <RestoreWatcher labels={{ restarting: t("backup.restoring"), timeout: t("backup.restoreTimeout") }} />
        ) : result ? (
          <Alert tone={result.status === "ok" ? "success" : "warning"}>
            {result.status === "ok"
              ? t("backup.last.ok", { name: result.from, date: when(result.at) })
              : t("backup.last.rolledBack", { name: result.from, date: when(result.at), reason: result.reason ?? "–" })}
          </Alert>
        ) : null}

        <Card title={t("backup.create.title")}>
          <p className="mb-4 text-sm text-ink-muted">
            {settings.enabled ? t("backup.schedule.on", { hour: String(settings.hour).padStart(2, "0"), keep: settings.keep }) : t("backup.schedule.off")}
          </p>
          <CreateBackupForm label={t("backup.create.button")} />
        </Card>

        <Card title={t("backup.list.title")} padded={false}>
          {backups.length === 0 ? (
            <EmptyState title={t("backup.list.empty")} />
          ) : (
            <Table className="min-w-[44rem]">
                <thead>
                  <tr>
                    <th>{t("backup.list.time")}</th>
                    <th>{t("backup.list.kind")}</th>
                    <th>{t("backup.list.size")}</th>
                    <th>{t("backup.list.files")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {backups.map((b) => (
                    <tr key={b.name}>
                      <td className="tabular whitespace-nowrap">{when(b.createdAt)}</td>
                      <td>
                        <Badge tone={KIND_TONE[b.kind]}>{td(`backup.kinds.${b.kind}`, b.kind)}</Badge>
                      </td>
                      <td className="tabular text-ink-muted">{size(b.size)}</td>
                      <td className="tabular text-ink-muted">{b.fileCount > 0 ? `${b.fileCount} · ${size(b.fileBytes)}` : "–"}</td>
                      <td>
                        <div className="flex items-start justify-end gap-2">
                          <LinkButton size="sm" external href={`/api/backups/${b.name}`} download>
                            <Download className="size-3.5" aria-hidden /> {t("backup.list.download")}
                          </LinkButton>
                          <RestoreForm name={b.name} label={t("backup.list.restore")} confirm={t("backup.list.confirmRestore", { date: when(b.createdAt) })} />
                          <form action={removeBackup}>
                            <input type="hidden" name="name" value={b.name} />
                            <ConfirmSubmitButton message={t("backup.list.confirmDelete")} aria-label={t("common.delete")}>
                              <Trash2 className="size-3.5" aria-hidden />
                            </ConfirmSubmitButton>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
          )}
        </Card>

        <Card title={t("backup.upload.title")}>
          <UploadForm
            labels={{
              button: t("backup.upload.button"),
              hint: t("backup.upload.hint"),
              uploading: t("backup.upload.uploading"),
              done: t("backup.upload.done"),
              errors: {
                notBackup: t("backup.errors.notBackup"),
                corrupt: t("backup.errors.corrupt"),
                newer: t("backup.errors.newer"),
                uploadFailed: t("backup.errors.uploadFailed"),
              },
            }}
          />
        </Card>

        <p className="text-xs text-ink-muted">{t("backup.note")}</p>
      </div>
    </>
  );
}
