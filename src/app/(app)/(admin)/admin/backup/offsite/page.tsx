import type { Metadata } from "next";
import { Download } from "lucide-react";
import { Alert, Card, EmptyState } from "@/components/ui/layout";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { DataTable } from "@/components/ui/data-table";
import { LinkButton } from "@/components/ui/buttons";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { OFFSITE_KEEP_MAX } from "@/lib/offsite/target";
import { withTimeout } from "@/lib/with-timeout";
import { requirePermission } from "@/server/auth/session";
import { listOffsiteBackups, type RemoteBackup } from "@/server/backup/offsite/service";
import { OffsiteError } from "@/server/backup/offsite/transport";
import { getOffsiteSettings, hasOffsiteCredentials, isConfigured } from "@/server/backup/offsite/settings";
import { jobStateOf } from "@/server/jobs/status";
import { recoveryKeyStatus } from "@/server/recovery-key";
import { BackupTabs } from "@/modules/admin/backup/backup-tabs";
import { fetchOffsiteBackupAction } from "@/modules/admin/backup/offsite-actions";
import { OffsiteForm, OffsiteTools } from "@/modules/admin/backup/panels";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("backup.offsite.title") };
}

const size = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

type Remote = { files: RemoteBackup[] } | { error: "connect" | "auth" | "hostKey" | "server" | "notFound" | "timeout" | "config" };

/** Die Liste vom Ziel wird nur auf Wunsch geholt (`?remote=1`): ein langsames Ziel soll die Seite nicht aufhalten. */
async function loadRemote(): Promise<Remote> {
  try {
    return await withTimeout<Remote>(listOffsiteBackups().then((files) => ({ files })), 20_000, { error: "timeout" });
  } catch (error) {
    return { error: error instanceof OffsiteError ? error.code : "server" };
  }
}

export default async function OffsitePage({ searchParams }: { searchParams: Promise<{ remote?: string }> }) {
  const session = await requirePermission("backup.manage");
  const { remote: showRemote } = await searchParams;
  const { t, tp, date } = await getI18n();
  const [settings, hasCredentials, key, job] = [await getOffsiteSettings(), await hasOffsiteCredentials(), await recoveryKeyStatus(), await jobStateOf("backup.offsite")];
  const configured = isConfigured(settings) && hasCredentials;
  const remote = showRemote === "1" && configured ? await loadRemote() : null;
  const when = (d: Date | string) => date(d, { dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <PageHeader title={t("backup.offsite.title")} description={t("backup.offsite.description")} help="admin.backup" />
      <BackupTabs active="offsite" session={session} />
      <div className="flex max-w-4xl flex-col gap-5">
        <p className="text-sm text-ink-muted">{t("backup.offsite.intro")}</p>

        {settings.enabled && job && job.failures > 0 ? (
          <Alert tone="danger">
            {tp("backup.offsite.failed", job.failures, { date: job.lastRunAt ? when(job.lastRunAt) : "–", reason: job.lastMessage ?? "–", next: job.nextRunAt ? when(job.nextRunAt) : "–" })}
          </Alert>
        ) : null}

        {!key.confirmed ? (
          <Alert tone="warning">
            <span className="flex flex-wrap items-center justify-between gap-3">
              <span>{t("backup.offsite.needKey")}</span>
              {session.can("backup.keys") ? (
                <LinkButton size="sm" href="/admin/backup/key">
                  {t("backup.offsite.toKey")}
                </LinkButton>
              ) : null}
            </span>
          </Alert>
        ) : null}

        <p className="text-sm">{settings.enabled ? (job?.lastRunAt && job.failures === 0 ? t("backup.offsite.status.on", { date: when(job.lastRunAt) }) : "") : t("backup.offsite.status.off")}</p>

        <OffsiteForm
          initial={{ enabled: settings.enabled, protocol: settings.protocol, host: settings.host, port: settings.port, path: settings.path, url: settings.url, username: settings.username, hostKey: settings.hostKey, keep: settings.keep }}
          hasCredentials={hasCredentials}
          keyReady={key.confirmed}
          keepMax={OFFSITE_KEEP_MAX}
        />

        {configured ? (
          <Card title={t("backup.offsite.test")}>
            <OffsiteTools canRun={settings.enabled} />
          </Card>
        ) : null}

        {configured ? (
          <section aria-labelledby="offsite-remote-title">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 id="offsite-remote-title" className="text-sm font-semibold">
                {t("backup.offsite.remote.title")}
              </h2>
              {remote ? null : (
                <LinkButton size="sm" href="/admin/backup/offsite?remote=1">
                  {t("backup.offsite.remote.show")}
                </LinkButton>
              )}
            </div>
            {remote && "error" in remote ? (
              <Alert tone="danger">{t("backup.offsite.remote.loadFailed", { reason: t(`backup.offsite.errors.${remote.error}`, { detail: "", fingerprint: "" }) })}</Alert>
            ) : remote ? (
              <DataTable
                caption={t("backup.offsite.remote.title")}
                rows={remote.files}
                rowKey={(f) => f.file}
                minWidth="36rem"
                empty={<EmptyState title={t("backup.offsite.remote.empty")} />}
                columns={[
                  { id: "time", header: t("backup.offsite.remote.time"), priority: "primary", cell: (f) => <span className="tabular whitespace-nowrap">{f.modifiedAt ? when(f.modifiedAt) : f.name}</span> },
                  { id: "size", header: t("backup.offsite.remote.size"), cell: (f) => <span className="tabular text-ink-muted">{size(f.size)}</span> },
                  {
                    id: "actions",
                    header: t("common.actions"),
                    hideHeader: true,
                    align: "end",
                    cell: (f) => (
                      <form action={fetchOffsiteBackupAction}>
                        <input type="hidden" name="file" value={f.file} />
                        <ConfirmSubmitButton message={t("backup.offsite.remote.confirmFetch")} variant="secondary" size="sm" target={f.name}>
                          <Download className="size-3.5" aria-hidden /> {t("backup.offsite.remote.fetch")}
                        </ConfirmSubmitButton>
                      </form>
                    ),
                  },
                ]}
              />
            ) : null}
          </section>
        ) : null}

        <p className="text-xs text-ink-muted">{t("backup.offsite.note")}</p>
      </div>
    </>
  );
}
