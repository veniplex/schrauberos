import { TabNav } from "@/components/ui/tab-nav";
import { getI18n } from "@/i18n/server";
import type { AppSession } from "@/server/auth/session";

/** Reiter der Backup-Seiten: Backups · Off-Site · Wiederherstellungsschlüssel (nur mit dem Recht `backup.keys`). */
export async function BackupTabs({ active, session }: { active: "backups" | "offsite" | "key"; session: AppSession }) {
  const { t } = await getI18n();
  const items = [
    { href: "/admin/backup", label: t("backup.tabs.backups"), active: active === "backups" },
    { href: "/admin/backup/offsite", label: t("backup.tabs.offsite"), active: active === "offsite" },
    ...(session.can("backup.keys") ? [{ href: "/admin/backup/key", label: t("backup.tabs.key"), active: active === "key" }] : []),
  ];
  return <TabNav label={t("backup.tabs.label")} items={items} />;
}
