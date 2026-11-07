import { TabNav } from "@/components/ui/tab-nav";
import { getI18n } from "@/i18n/server";

/** Reiter der Seiten „API & Webhooks“: Tokens · Dienstkonten · Webhooks · Dokumentation. */
export async function ApiTabs({ active }: { active: "tokens" | "accounts" | "webhooks" | "docs" }) {
  const { t } = await getI18n();
  return (
    <TabNav
      label={t("api.tabs.label")}
      items={[
        { href: "/admin/api", label: t("api.tabs.tokens"), active: active === "tokens" },
        { href: "/admin/api/accounts", label: t("api.tabs.accounts"), active: active === "accounts" },
        { href: "/admin/api/webhooks", label: t("api.tabs.webhooks"), active: active === "webhooks" },
        { href: "/admin/api/docs", label: t("api.tabs.docs"), active: active === "docs" },
      ]}
    />
  );
}
