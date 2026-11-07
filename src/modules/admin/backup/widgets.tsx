import Link from "next/link";
import { Alert, Card } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import type { WidgetDef } from "@/modules/types";
import { listBackups } from "@/server/backup/core";
import { autoBackupFailing } from "@/server/backup/status";
import { jobStateOf } from "@/server/jobs/status";

/** Backup-Zustand auf der Übersicht: wann das letzte Backup entstand – und, wenn das automatische Backup fehlschlägt, eine deutliche Meldung. */
export async function BackupWidget() {
  const { t, tp, date } = await getI18n();
  const last = (await listBackups())[0];
  const job = await jobStateOf("backup.auto");
  const failing = autoBackupFailing(job, last?.createdAt ?? null);

  return (
    <Card
      title={t("backup.widget.title")}
      actions={
        <Link href="/admin/backup" className="inline-flex min-h-(--tap-row) min-w-(--tap-row) items-center text-sm text-accent-text hover:underline">
          {t("backup.widget.open")}
        </Link>
      }
    >
      <div className="flex flex-col gap-3">
        {failing && job ? <Alert tone="danger">{tp("backup.widget.failed", job.failures)}</Alert> : null}
        <p className="text-sm">{last ? t("backup.widget.last", { date: date(last.createdAt, { dateStyle: "medium", timeStyle: "short" }) }) : t("backup.widget.none")}</p>
      </div>
    </Card>
  );
}

/** Dashboard-Bausteine dieser Funktion (von der Registry eingesammelt). */
export const widgets: WidgetDef[] = [{ id: "backup-status", feature: "admin.backup", permission: "backup.manage", span: 1, order: 90, Component: BackupWidget }];
