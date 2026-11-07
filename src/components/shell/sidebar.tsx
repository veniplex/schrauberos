"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Menu as MenuIcon, Wrench } from "lucide-react";
import { Button } from "@/components/ui/buttons";
import { Disclosure } from "@/components/ui/disclosure";
import { Drawer } from "@/components/ui/drawer";
import { NavLink } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import { activeHref } from "@/lib/nav-active";
import { collapsedCookie } from "@/lib/nav-state";

/** Ein Navigationseintrag; das Symbol entsteht auf dem Server (siehe `nav-icons`). */
export type SidebarItem = { href: string; label: string; icon: ReactNode };
/** Eine Navigationsgruppe = ein Modul: Titel auch bei nur einem Eintrag, die Einträge stehen eingerückt darunter. */
export type SidebarGroup = { id: string; label: string; items: SidebarItem[] };

/** Der aktive Eintrag über alle Gruppen: der längste passende gewinnt (nie zwei gleichzeitig). */
function activeItem(items: SidebarItem[], pathname: string): string | null {
  return activeHref(pathname, items.map((i) => i.href));
}

function rememberCollapsed(ids: string[]) {
  document.cookie = collapsedCookie(ids, window.location.protocol === "https:");
}

/**
 * Anwendungsrahmen: Seitenleiste ab 1024 px, darunter Kopfzeile mit Menü-Knopf und Seitenfach (`Drawer`), Sprunglink, Schnellsuche und „Neu“ in der Kopfleiste.
 *
 * - **Gruppen** (Module) mit Titel, auch bei nur einem Eintrag; Zustand ein-/ausgeklappt merkt ein Cookie (der Server liest es mit, nichts springt). Die Gruppe der aktuellen
 *   Seite ist immer offen und nicht einklappbar. „Übersicht“ steht oben, „Hilfe“ am Ende.
 * - **Seitenfach** (< 1024 px): Schließen-Knopf, Escape, Fokus gefangen und zurückgegeben, Seite dahinter gesperrt, `100dvh`, Safe-Area; schließt bei Navigation und wenn das Fenster
 *   auf Seitenleisten-Breite wächst. Konto und Abmelden liegen in der Kopfzeile.
 */
export function Sidebar({
  workshopName,
  logoSrc,
  primary,
  groups,
  trailing,
  collapsed: initialCollapsed,
  search,
  quickNew,
  account,
  accountCompact,
  children,
}: {
  workshopName: string;
  /** Adresse des Logos (`/api/logo?v=…`) oder null */
  logoSrc: string | null;
  /** Oben, ohne Gruppe (Übersicht) */
  primary: SidebarItem[];
  groups: SidebarGroup[];
  /** Am Ende, ohne Gruppe (Hilfe) */
  trailing: SidebarItem[];
  /** Eingeklappte Gruppen (aus dem Cookie) */
  collapsed: string[];
  /** Schnellsuche (client) – in Kopfleiste (Desktop) und Kopfzeile (Handy/Tablet) */
  search: ReactNode;
  quickNew: ReactNode;
  /** Benutzer-Menü am Fuß der Seitenleiste */
  account: ReactNode;
  /** Benutzer-Menü als Symbol in der Kopfzeile */
  accountCompact: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  const [collapsed, setCollapsed] = useState(() => new Set(initialCollapsed));

  // State-Anpassung während des Renderns statt im Effect: Seitenfach bei Navigation schließen
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  // Wächst das Fenster auf Seitenleisten-Breite, gehört das Seitenfach nicht mehr in den Weg
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const onChange = () => {
      if (query.matches) setOpen(false);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const all = [...primary, ...groups.flatMap((g) => g.items), ...trailing];
  const active = activeItem(all, pathname);
  const activeGroup = groups.find((g) => g.items.some((i) => i.href === active))?.id;

  const toggleGroup = (id: string, isOpen: boolean) => {
    const next = new Set(collapsed);
    if (isOpen) next.delete(id);
    else next.add(id);
    setCollapsed(next);
    rememberCollapsed([...next]);
  };

  const link = (item: SidebarItem) => (
    <li key={item.href}>
      <NavLink href={item.href} active={item.href === active} icon={item.icon}>
        {item.label}
      </NavLink>
    </li>
  );

  const nav = (
    <nav aria-label={t("nav.main")} className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 py-4">
      <ul className="flex flex-col gap-0.5">{primary.map(link)}</ul>
      {groups.map((group) => (
        <Disclosure
          key={group.id}
          variant="section"
          title={group.label}
          locked={group.id === activeGroup}
          open={!collapsed.has(group.id)}
          onOpenChange={(isOpen) => toggleGroup(group.id, isOpen)}
        >
          <ul className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-line pl-1.5">{group.items.map(link)}</ul>
        </Disclosure>
      ))}
      <ul className="mt-auto flex flex-col gap-0.5 border-t border-line pt-3">{trailing.map(link)}</ul>
    </nav>
  );

  const brand = (
    <Link href="/" className="flex min-h-14 items-center gap-3 border-b border-line px-5">
      {logoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element -- Logo aus dem Werkstatt-Profil (/api/logo)
        <img src={logoSrc} alt="" className="size-8 shrink-0 rounded-sm object-contain" />
      ) : (
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-accent-ink">
          <Wrench className="size-4" aria-hidden />
        </span>
      )}
      <span className="truncate text-sm font-semibold">{workshopName}</span>
    </Link>
  );

  const content = (footer: ReactNode) => (
    <>
      {brand}
      {nav}
      <div className="border-t border-line p-3">{footer}</div>
    </>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <a href="#main-content" className="skip-link no-print">
        {t("common.skipToContent")}
      </a>

      {/* Desktop: Seitenleiste */}
      <aside className="no-print sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface lg:flex">{content(account)}</aside>

      {/* Handy und Tablet (< 1024 px): Kopfzeile mit Menü-Knopf, Suche, „Neu“ und Konto; die Navigation liegt im Seitenfach */}
      {/* `contents`: Der Wrapper bildet keinen eigenen Kasten – sonst wäre er nur so hoch wie die Kopfzeile, und `sticky` hätte nirgends Platz zum Kleben */}
      <div className="no-print contents lg:hidden">
        <header className="sticky top-0 z-30 flex min-h-(--sticky-top) items-center gap-2 border-b border-line glass-bar px-3 pt-[env(safe-area-inset-top)]">
          <Button variant="secondary" size="icon" aria-label={t("nav.menu")} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(true)}>
            <MenuIcon className="size-4" aria-hidden />
          </Button>
          <span className="min-w-0 flex-1 truncate px-1 text-sm font-semibold">{workshopName}</span>
          {search}
          {quickNew}
          {accountCompact}
        </header>
        <Drawer open={open} onClose={() => setOpen(false)} label={t("nav.main")} closeLabel={t("nav.menuClose")}>
          {content(account)}
        </Drawer>
      </div>

      <div className="min-w-0">
        {/* Desktop: Kopfleiste mit Suche und „Neu“ */}
        <div className="no-print sticky top-0 z-20 hidden h-14 items-center gap-3 border-b border-line glass-bar px-6 lg:flex">
          {search}
          <div className="ml-auto">{quickNew}</div>
        </div>
        {children}
      </div>
    </div>
  );
}
