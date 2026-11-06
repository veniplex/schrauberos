import type { ReactNode } from "react";
import { Sidebar, type SidebarGroup } from "@/components/shell/sidebar";
import { UserMenu } from "@/components/shell/user-menu";
import { logoutAction } from "@/app/login/actions";
import { MODULES } from "@/modules/catalog";
import { navFor } from "@/modules/registry";
import { getI18n, getLocale, getTheme } from "@/i18n/server";
import { requireSession } from "@/server/auth/session";
import { RecoveryBanner } from "@/platform/account/recovery-banner";
import { getWorkshop } from "@/server/workshop";

export default async function AppLayout({ children }: { children: ReactNode }) {
  // Die Erzwingung der Passwortänderung passiert in den Seiten (requireSession/requirePermission).
  const session = await requireSession({ allowPasswordChange: true });
  const [{ t }, workshop, locale, theme] = await Promise.all([getI18n(), getWorkshop(), getLocale(), getTheme()]);

  const entries = navFor(session);
  const groups: SidebarGroup[] = [
    // Dashboard steht immer an erster Stelle
    {
      id: "top",
      label: null,
      // Plattform: für alle angemeldeten Benutzer, unabhängig von Modulen und Rechten
      items: [
        { href: "/", label: t("nav.dashboard"), icon: "dashboard" },
        { href: "/help", label: t("nav.help"), icon: "help" },
      ],
    },
    ...MODULES.map((m) => ({
      id: m.id,
      label: t(m.nameKey),
      items: entries.filter((n) => n.module === m.id).map((n) => ({ href: n.href, label: t(n.labelKey), icon: n.icon })),
    })).filter((g) => g.items.length > 0),
  ];

  return (
    <Sidebar
      workshopName={workshop.name}
      logoDataUrl={workshop.logoDataUrl}
      groups={groups}
      footer={<UserMenu name={session.user.name} roles={session.user.roleNames.join(", ") || "–"} locale={locale} theme={theme} logoutAction={logoutAction} />}
    >
      <main className="mx-auto w-full max-w-[88rem] px-4 py-6 sm:px-6 lg:py-8">
        <RecoveryBanner user={{ id: session.user.id, isAdmin: session.user.isAdmin }} />
        {children}
      </main>
    </Sidebar>
  );
}
