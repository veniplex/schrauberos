import Link from "next/link";
import { LogOut, UserRound } from "lucide-react";
import type { AppSession } from "@/server/auth/session";
import { getI18n, getLocale, getTheme } from "@/i18n/server";
import { logoutAction } from "@/app/login/actions";
import { LocaleSwitch, ThemeSwitch } from "./switches";

export async function Topbar({ session }: { session: AppSession }) {
  const [{ t }, locale, theme] = await Promise.all([getI18n(), getLocale(), getTheme()]);
  return (
    <div className="no-print sticky top-0 z-20 flex min-h-14 items-center justify-end gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur sm:px-6">
      <LocaleSwitch current={locale} />
      <ThemeSwitch current={theme} />
      <details className="relative">
        <summary className="btn btn-ghost list-none gap-2 [&::-webkit-details-marker]:hidden">
          <UserRound className="size-4" aria-hidden />
          <span className="hidden max-w-40 truncate sm:inline">{session.user.name}</span>
        </summary>
        <div className="absolute right-0 top-full z-30 mt-1 w-60 rounded-lg border border-line bg-surface p-1 shadow-pop">
          <div className="border-b border-line px-3 py-2">
            <p className="truncate text-sm font-medium">{session.user.name}</p>
            <p className="truncate text-xs text-ink-muted">{session.user.roleNames.join(", ") || "–"}</p>
          </div>
          <Link href="/account" className="mt-1 flex min-h-9 items-center gap-2 rounded-md px-3 text-sm hover:bg-surface-hover">
            <UserRound className="size-4" aria-hidden /> {t("nav.account")}
          </Link>
          <form action={logoutAction}>
            <button type="submit" className="flex min-h-9 w-full items-center gap-2 rounded-md px-3 text-left text-sm hover:bg-surface-hover">
              <LogOut className="size-4" aria-hidden /> {t("auth.logout")}
            </button>
          </form>
        </div>
      </details>
    </div>
  );
}
