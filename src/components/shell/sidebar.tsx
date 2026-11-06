"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BookOpen,
  Blocks,
  ScrollText,
  Download,
  FileText,
  CircleHelp,
  HardDriveDownload,
  Activity,
  Cable,
  CalendarDays,
  CalendarOff,
  Car,
  Contact,
  Disc3,
  Globe,
  LayoutDashboard,
  Menu as MenuIcon,
  Network,
  Receipt,
  Server,
  Settings,
  Truck,
  ShieldCheck,
  UserCog,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import type { IconName } from "@/modules/define";
import { Button } from "@/components/ui/buttons";
import { Disclosure } from "@/components/ui/disclosure";
import { NavLink } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import { activeHref } from "@/lib/nav-active";

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
  vehicles: Car,
  invoices: Receipt,
  employees: Contact,
  absences: CalendarOff,
  fleet: Truck,
  docs: FileText,
  handbook: BookOpen,
  modules: Blocks,
  audit: ScrollText,
  updates: Download,
  backup: HardDriveDownload,
  system: Activity,
  help: CircleHelp,
};

export type SidebarItem = { href: string; label: string; icon: IconName };
/** Eine Navigationsgruppe: ohne Titel immer sichtbar (Übersicht, Hilfe), sonst ein Modul – aufklappbar, außer es hat nur einen Eintrag. */
export type SidebarGroup = { id: string; label: string | null; items: SidebarItem[] };

/** Der aktive Eintrag über alle Gruppen: der längste passende gewinnt (nie zwei gleichzeitig). */
function activeItem(groups: SidebarGroup[], pathname: string): string | null {
  return activeHref(pathname, groups.flatMap((g) => g.items.map((i) => i.href)));
}

export function Sidebar({
  workshopName,
  logoDataUrl,
  groups,
  footer,
  children,
}: {
  workshopName: string;
  logoDataUrl: string | null;
  groups: SidebarGroup[];
  /** Benutzer-Menü am Fuß der Leiste */
  footer: React.ReactNode;
  /** Inhalt */
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  // Aufgeklappte Gruppen: anfangs die der aktuellen Seite (auf Übersicht, Hilfe & Co. alle); wer weiter navigiert, bekommt die neue Gruppe aufgeklappt dazu
  const groupOf = (path: string) => {
    const href = activeItem(groups, path);
    return href ? groups.find((g) => g.items.some((i) => i.href === href))?.id : undefined;
  };
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(groupOf(pathname) ? [groupOf(pathname)!] : groups.map((g) => g.id)));

  // State-Anpassung während des Renderns statt im Effect: Drawer bei Navigation schließen, Gruppe der neuen Seite öffnen
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
    const current = groupOf(pathname);
    if (current && !expanded.has(current)) setExpanded(new Set([...expanded, current]));
  }

  const setGroupOpen = (id: string, value: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });

  const active = activeItem(groups, pathname);
  const link = (item: SidebarItem) => {
    const Icon = ICONS[item.icon];
    return (
      <li key={item.href}>
        <NavLink href={item.href} active={item.href === active} icon={<Icon className="size-[18px] shrink-0" aria-hidden />}>
          {item.label}
        </NavLink>
      </li>
    );
  };

  const nav = (
    <nav aria-label={t("nav.main")} className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 py-4">
      {groups.map((g) =>
        g.label && g.items.length > 1 ? (
          <Disclosure key={g.id} variant="section" title={g.label} open={expanded.has(g.id)} onOpenChange={(v) => setGroupOpen(g.id, v)}>
            <ul className="mt-1 flex flex-col gap-0.5">{g.items.map(link)}</ul>
          </Disclosure>
        ) : (
          <ul key={g.id} className="flex flex-col gap-0.5">
            {g.items.map(link)}
          </ul>
        ),
      )}
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

  const content = (
    <>
      {brand}
      {nav}
      <div className="border-t border-line p-3">{footer}</div>
    </>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      {/* Desktop */}
      <aside className="no-print sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface lg:flex">{content}</aside>

      {/* Mobil: Kopfzeile mit Menü-Knopf und Drawer */}
      <div className="no-print lg:hidden">
        <header className="sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur">
          <Button
            variant="secondary"
            size="icon"
            aria-label={open ? t("common.close") : t("nav.menu")}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-4" aria-hidden /> : <MenuIcon className="size-4" aria-hidden />}
          </Button>
          <span className="truncate text-sm font-semibold">{workshopName}</span>
        </header>
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
          {content}
        </aside>
      </div>

      <div className="min-w-0">{children}</div>
    </div>
  );
}
