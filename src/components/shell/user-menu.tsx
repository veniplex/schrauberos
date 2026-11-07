"use client";

import { LogOut, UserRound } from "lucide-react";
import { clearFormDrafts } from "@/components/ui/form";
import { Menu, MenuHeader, MenuLink, MenuSubmit } from "@/components/ui/menu";
import { useI18n } from "@/i18n/client";
import type { Locale } from "@/i18n/config";
import type { Theme } from "@/lib/constants";
import { LocaleSwitch, ThemeSwitch } from "./switches";

/**
 * Benutzer: Name und Rollen, Sprache/Darstellung, Mein Konto, Abmelden. `compact`: nur das Symbol (Kopfzeile auf Handy und Tablet, Konto und Abmelden sind dort immer
 * erreichbar); sonst am Fuß der Seitenleiste mit Name und Rollen. Beim Abmelden werden die Formular-Entwürfe des Browsers gelöscht.
 */
export function UserMenu({
  name,
  roles,
  locale,
  theme,
  logoutAction,
  compact,
}: {
  name: string;
  roles: string;
  locale: Locale;
  theme: Theme;
  logoutAction: () => Promise<void>;
  compact?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Menu
      block={!compact}
      placement={compact ? "down" : "up"}
      align={compact ? "end" : "start"}
      label={name}
      trigger={
        compact ? (
          <UserRound className="size-4 shrink-0" aria-hidden />
        ) : (
          <>
            <UserRound className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 text-left">
              <span className="block truncate text-sm font-medium">{name}</span>
              <span className="block truncate text-xs font-normal text-ink-muted">{roles}</span>
            </span>
          </>
        )
      }
      size={compact ? "icon" : "md"}
    >
      <MenuHeader>
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="truncate text-xs text-ink-muted">{roles}</p>
      </MenuHeader>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <LocaleSwitch current={locale} />
        <ThemeSwitch current={theme} />
      </div>
      <MenuLink href="/account">
        <UserRound className="size-4" aria-hidden /> {t("nav.account")}
      </MenuLink>
      <form action={logoutAction} onSubmit={() => clearFormDrafts()}>
        <MenuSubmit>
          <LogOut className="size-4" aria-hidden /> {t("auth.logout")}
        </MenuSubmit>
      </form>
    </Menu>
  );
}
