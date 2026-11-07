import type { Metadata } from "next";
import { Download, Trash2 } from "lucide-react";
import { Alert, Card, EmptyState, StatusBadge } from "@/components/ui/layout";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton } from "@/components/ui/buttons";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { getI18n } from "@/i18n/server";
import { readPending, readRestoreResult } from "@/lib/updates/restore";
import { requirePermission } from "@/server/auth/session";
import { listBackups } from "@/server/backup/core";
import { autoBackupFailing } from "@/server/backup/status";
import { getBackupSettings } from "@/server/backup/settings";
import { jobStateOf } from "@/server/jobs/status";
import { removeBackup } from "@/modules/admin/backup/actions";
import { BACKUP_KIND_TONE } from "@/modules/admin/backup/status-tone";
import { CreateBackupForm, RestoreForm, RestoreWatcher, RetryAutoBackupForm, UploadForm } from "@/modules/admin/backup/panels";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("backup.title") };
}

function size(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default async function BackupPage() {
  await requirePermission("backup.manage");
  const { t, td, tp, date } = await getI18n();
  const [settings, backups, autoJob] = [await getBackupSettings(), await listBackups(), await jobStateOf("backup.auto")];
  const pending = readPending();
  const result = readRestoreResult();
  const when = (d: Date | string) => date(d, { dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <PageHeader title={t("backup.title")} description={t("backup.description")} help="admin.backup" />
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

        {autoJob && autoBackupFailing(autoJob, backups[0]?.createdAt ?? null) ? (
          <Alert tone="danger">
            {tp("backup.failed", autoJob.failures, {
              date: autoJob.lastRunAt ? when(autoJob.lastRunAt) : "–",
              reason: autoJob.lastMessage ?? "–",
              next: autoJob.nextRunAt ? when(autoJob.nextRunAt) : "–",
            })}
            <RetryAutoBackupForm label={t("backup.retry.button")} />
          </Alert>
        ) : null}

        <Card title={t("backup.create.title")}>
          <p className="mb-4 text-sm text-ink-muted">
            {settings.enabled ? t("backup.schedule.on", { hour: String(settings.hour).padStart(2, "0") }) : t("backup.schedule.off")}
          </p>
          <CreateBackupForm label={t("backup.create.button")} />
        </Card>

        <section aria-labelledby="backup-list-title">
          <h2 id="backup-list-title" className="mb-2 text-sm font-semibold">
            {t("backup.list.title")}
          </h2>
          <DataTable
            caption={t("backup.list.title")}
            rows={backups}
            rowKey={(b) => b.name}
            minWidth="44rem"
            empty={<EmptyState title={t("backup.list.empty")} />}
            columns={[
              { id: "time", header: t("backup.list.time"), priority: "primary", cell: (b) => <span className="tabular whitespace-nowrap">{when(b.createdAt)}</span> },
              { id: "kind", header: t("backup.list.kind"), cell: (b) => <StatusBadge tone={BACKUP_KIND_TONE[b.kind]}>{td(`backup.kinds.${b.kind}`, b.kind)}</StatusBadge> },
              { id: "size", header: t("backup.list.size"), cell: (b) => <span className="tabular text-ink-muted">{size(b.size)}</span> },
              { id: "files", header: t("backup.list.files"), cell: (b) => <span className="tabular text-ink-muted">{b.fileCount > 0 ? `${b.fileCount} · ${size(b.fileBytes)}` : "–"}</span> },
              {
                id: "actions",
                header: t("common.actions"),
                hideHeader: true,
                align: "end",
                cell: (b) => (
                  <div className="flex items-start justify-end gap-2">
                    <LinkButton size="sm" external href={`/api/backups/${b.name}`} download>
                      <Download className="size-3.5" aria-hidden /> {t("backup.list.download")}
                    </LinkButton>
                    <RestoreForm name={b.name} label={t("backup.list.restore")} confirm={t("backup.list.confirmRestore", { date: when(b.createdAt) })} />
                    <form action={removeBackup}>
                      <input type="hidden" name="name" value={b.name} />
                      <ConfirmSubmitButton message={t("backup.list.confirmDelete")} label={t("common.delete")}>
                        <Trash2 className="size-3.5" aria-hidden />
                      </ConfirmSubmitButton>
                    </form>
                  </div>
                ),
              },
            ]}
          />
        </section>

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
                tooLarge: t("backup.errors.tooLarge"),
                diskFull: t("backup.errors.diskFull"),
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
