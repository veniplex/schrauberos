import type { Metadata } from "next";
import { Alert, Card } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { requirePermission } from "@/server/auth/session";
import { recoveryKeyStatus } from "@/server/recovery-key";
import { BackupTabs } from "@/modules/admin/backup/backup-tabs";
import { RecoveryKeyForm } from "@/modules/admin/backup/panels";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("backup.key.title") };
}

/** Wiederherstellungsschlüssel (P1b-4a): erzeugen, einmalig anzeigen, als gesichert bestätigen. Nur Administratoren (Recht `backup.keys`, adminOnly). */
export default async function RecoveryKeyPage() {
  const session = await requirePermission("backup.keys");
  const { t, date } = await getI18n();
  const status = await recoveryKeyStatus();
  return (
    <>
      <PageHeader title={t("backup.key.title")} description={t("backup.key.description")} help="admin.backup" />
      <BackupTabs active="key" session={session} />
      <div className="flex max-w-3xl flex-col gap-5">
        {session.user.isAdmin ? (
          <Card>
            <RecoveryKeyForm status={{ exists: status.exists, stale: status.stale, confirmed: status.confirmed, createdOn: status.createdAt ? date(status.createdAt, { dateStyle: "medium" }) : null }} />
          </Card>
        ) : (
          <Alert tone="warning">{t("backup.key.adminOnly")}</Alert>
        )}
      </div>
    </>
  );
}
