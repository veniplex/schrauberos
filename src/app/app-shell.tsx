import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { NewMenu } from "@/components/shell/new-menu";
import { QuickSearch } from "@/components/shell/quick-search";
import { loadNavIcons, FALLBACK_ICON } from "@/components/shell/nav-icons";
import { Sidebar, type SidebarGroup, type SidebarItem } from "@/components/shell/sidebar";
import { UserMenu } from "@/components/shell/user-menu";
import { logoutAction } from "@/app/login/actions";
import { MODULES } from "@/modules/catalog";
import { navFor, quickActionsFor, searchProvidersFor } from "@/modules/registry";
import { getI18n, getLocale, getTheme } from "@/i18n/server";
import { NAV_COOKIE, parseCollapsed } from "@/lib/nav-state";
import type { AppSession } from "@/server/auth/session";
import { RecoveryBanner } from "@/platform/account/recovery-banner";
import { SecretsBanner } from "@/platform/account/secrets-banner";
import { SecurityBanner } from "@/platform/account/security-banner";
import { deviceCookieName } from "@/lib/session-cookie";
import { FlashNotice } from "@/components/shell/flash-notice";
import { DraftScope } from "@/components/ui/draft-scope";
import { getWorkshop } from "@/server/workshop";

const ICON_CLASS = "size-[18px] shrink-0";

/**
 * Der Anwendungsrahmen (Navigation, Suche, „Neu“, Benutzermenü, Hinweisbanner) um den Seiteninhalt – für `(app)/layout.tsx` und die Fehlerseite 404.
 * Die Navigation kommt aus dem Katalog (Funktionen mit Recht); die Symbole werden **je Gruppe** geladen (`nav-icons`) und auf dem Server zu Elementen.
 */
export async function AppShell({ session, children }: { session: AppSession; children: ReactNode }) {
  const [{ t }, workshop, locale, theme, jar] = await Promise.all([getI18n(), getWorkshop(), getLocale(), getTheme(), cookies()]);

  const entries = navFor(session);
  const moduleGroups = MODULES.map((m) => ({ module: m, entries: entries.filter((n) => n.module === m.id) })).filter((g) => g.entries.length > 0);
  const icons = await loadNavIcons(["platform", ...moduleGroups.map((g) => g.module.id)]);
  const iconOf = (name: keyof typeof icons) => {
    const Icon = icons[name] ?? FALLBACK_ICON;
    return <Icon className={ICON_CLASS} aria-hidden />;
  };

  // Plattform: für alle angemeldeten Benutzer, unabhängig von Modulen und Rechten – Übersicht oben, Hilfe am Ende
  const primary: SidebarItem[] = [{ href: "/", label: t("nav.dashboard"), icon: iconOf("dashboard") }];
  const trailing: SidebarItem[] = [{ href: "/help", label: t("nav.help"), icon: iconOf("help") }];
  const groups: SidebarGroup[] = moduleGroups.map(({ module, entries: items }) => ({
    id: module.id,
    label: t(module.nameKey),
    items: items.map((n) => ({ href: n.href, label: t(n.labelKey), icon: iconOf(n.icon) })),
  }));

  const quickIcons = await loadNavIcons([...new Set(quickActionsFor(session).map((a) => a.module))]);
  const actions = quickActionsFor(session).map((a) => {
    const Icon = quickIcons[a.icon] ?? icons[a.icon] ?? FALLBACK_ICON;
    return { id: a.id, href: a.href, label: t(a.labelKey), icon: <Icon className="size-4 shrink-0" aria-hidden /> };
  });

  // Das Abmelden bietet „Gerät vergessen“ nur an, wenn dieser Browser überhaupt ein Geräte-Cookie trägt
  const hasDevice = jar.has(deviceCookieName(false)) || jar.has(deviceCookieName(true));
  const user = { name: session.user.name, roles: session.user.roleNames.join(", ") || "–", locale, theme, logoutAction, hasDevice };

  return (
    <DraftScope userId={session.user.id}>
    <Sidebar
      workshopName={workshop.name}
      logoDataUrl={workshop.logoDataUrl}
      primary={primary}
      groups={groups}
      trailing={trailing}
      collapsed={parseCollapsed(jar.get(NAV_COOKIE)?.value)}
      // ohne ein einziges durchsuchbares Recht gibt es kein Suchfeld (die Route antwortete 403)
      search={searchProvidersFor(session).length > 0 ? <QuickSearch /> : null}
      quickNew={<NewMenu label={t("nav.new")} actions={actions} />}
      account={<UserMenu {...user} />}
      accountCompact={<UserMenu {...user} compact />}
    >
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[88rem] px-4 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] outline-none sm:px-6 lg:py-8 lg:pb-8">
        <FlashNotice />
        <RecoveryBanner user={{ id: session.user.id, isAdmin: session.user.isAdmin }} />
        <SecretsBanner user={{ isAdmin: session.user.isAdmin }} />
        <SecurityBanner userId={session.user.id} />
        {children}
      </main>
    </Sidebar>
    </DraftScope>
  );
}
