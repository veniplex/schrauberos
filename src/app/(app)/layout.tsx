import type { ReactNode } from "react";
import { Sidebar, type SidebarItem } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { navFor } from "@/modules/registry";
import { getI18n } from "@/i18n/server";
import { requireSession } from "@/server/auth/session";
import { getWorkshop } from "@/server/workshop";

export default async function AppLayout({ children }: { children: ReactNode }) {
  // Die Erzwingung der Passwortänderung passiert in den Seiten (requireSession/requirePermission).
  const session = await requireSession({ allowPasswordChange: true });
  const [{ t }, workshop] = await Promise.all([getI18n(), getWorkshop()]);

  const items: SidebarItem[] = navFor(session).map((n) => ({ href: n.href, label: t(n.labelKey), icon: n.icon, section: n.section }));
  // Dashboard steht immer an erster Stelle
  items.unshift({ href: "/", label: t("nav.dashboard"), icon: "dashboard", section: "top" });

  return (
    <Sidebar workshopName={workshop.name} logoDataUrl={workshop.logoDataUrl} items={items}>
      <Topbar session={session} />
      <main className="mx-auto w-full max-w-[88rem] px-4 py-6 sm:px-6 lg:py-8">{children}</main>
    </Sidebar>
  );
}
