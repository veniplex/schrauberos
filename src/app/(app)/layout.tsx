import type { ReactNode } from "react";
import { Sidebar, type SidebarGroup } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { MODULES } from "@/modules/catalog";
import { navFor } from "@/modules/registry";
import { getI18n } from "@/i18n/server";
import { requireSession } from "@/server/auth/session";
import { getWorkshop } from "@/server/workshop";

export default async function AppLayout({ children }: { children: ReactNode }) {
  // Die Erzwingung der Passwortänderung passiert in den Seiten (requireSession/requirePermission).
  const session = await requireSession({ allowPasswordChange: true });
  const [{ t }, workshop] = await Promise.all([getI18n(), getWorkshop()]);

  const entries = navFor(session);
  const groups: SidebarGroup[] = [
    // Dashboard steht immer an erster Stelle
    { id: "top", label: null, items: [{ href: "/", label: t("nav.dashboard"), icon: "dashboard" }] },
    ...MODULES.map((m) => ({
      id: m.id,
      label: t(m.nameKey),
      items: entries.filter((n) => n.module === m.id).map((n) => ({ href: n.href, label: t(n.labelKey), icon: n.icon })),
    })).filter((g) => g.items.length > 0),
  ];

  return (
    <Sidebar workshopName={workshop.name} logoDataUrl={workshop.logoDataUrl} groups={groups}>
      <Topbar session={session} />
      <main className="mx-auto w-full max-w-[88rem] px-4 py-6 sm:px-6 lg:py-8">{children}</main>
    </Sidebar>
  );
}
