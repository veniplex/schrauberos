"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Cable,
  CalendarDays,
  Disc3,
  Globe,
  LayoutDashboard,
  Menu,
  Network,
  Server,
  Settings,
  ShieldCheck,
  UserCog,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import type { IconName } from "@/modules/types";
import { useI18n } from "@/i18n/client";

const ICONS: Record<IconName, LucideIcon> = {
  dashboard: LayoutDashboard,
  calendar: CalendarDays,
  tires: Disc3,
  customers: Users,
  users: UserCog,
  roles: ShieldCheck,
  settings: Settings,
  network: Network,
  server: Server,
  ip: Globe,
  cabling: Cable,
};

export type SidebarItem = { href: string; label: string; icon: IconName; section: "main" | "it" | "admin" };

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({
  workshopName,
  logoDataUrl,
  items,
  children,
}: {
  workshopName: string;
  logoDataUrl: string | null;
  items: SidebarItem[];
  /** Topbar + Inhalt */
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);

  // Drawer bei Navigation schließen (State-Anpassung während des Renderns statt im Effect)
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  const groups: Array<{ id: string; label: string | null; items: SidebarItem[] }> = [
    { id: "main", label: null, items: items.filter((i) => i.section === "main") },
    { id: "it", label: t("nav.it"), items: items.filter((i) => i.section === "it") },
    { id: "admin", label: t("nav.administration"), items: items.filter((i) => i.section === "admin") },
  ].filter((g) => g.items.length > 0);

  const nav = (
    <nav aria-label={t("nav.main")} className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
      {groups.map((g) => (
        <div key={g.id}>
          {g.label ? <p className="mb-1 px-3 text-xs font-medium uppercase tracking-wide text-ink-muted">{g.label}</p> : null}
          <ul className="flex flex-col gap-0.5">
            {g.items.map((item) => {
              const Icon = ICONS[item.icon];
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={clsx(
                      "flex min-h-9 items-center gap-3 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                      active ? "bg-accent-subtle text-accent-text" : "text-ink-muted hover:bg-surface-hover hover:text-ink",
                    )}
                  >
                    <Icon className="size-[18px] shrink-0" aria-hidden />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const brand = (
    <Link href="/" className="flex min-h-14 items-center gap-3 border-b border-line px-5">
      {logoDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Data-URL aus dem Werkstatt-Profil
        <img src={logoDataUrl} alt="" className="size-8 shrink-0 rounded-sm object-contain" />
      ) : (
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-accent-ink">
          <Wrench className="size-4" aria-hidden />
        </span>
      )}
      <span className="truncate text-sm font-semibold">{workshopName}</span>
    </Link>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      {/* Desktop */}
      <aside className="no-print sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface lg:flex">
        {brand}
        {nav}
      </aside>

      {/* Mobil: Drawer */}
      <div className="no-print lg:hidden">
        <div
          className={clsx("fixed inset-0 z-40 bg-[var(--overlay)] transition-opacity", open ? "opacity-100" : "pointer-events-none opacity-0")}
          onClick={() => setOpen(false)}
          aria-hidden
        />
        <aside
          id="mobile-nav"
          className={clsx(
            "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-line bg-surface transition-transform",
            open ? "translate-x-0" : "-translate-x-full",
          )}
          aria-hidden={!open}
          inert={!open}
        >
          {brand}
          {nav}
        </aside>
        <button
          type="button"
          className="btn btn-secondary btn-icon fixed left-3 top-2.5 z-30"
          aria-label={open ? t("common.close") : t("nav.menu")}
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="size-4" aria-hidden /> : <Menu className="size-4" aria-hidden />}
        </button>
      </div>

      <div className="min-w-0">{children}</div>
    </div>
  );
}
