"use client";

import clsx from "clsx";
import { useTransition } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { setLocale, setTheme } from "@/server/actions/preferences";
import { LOCALES, type Locale } from "@/i18n/config";
import type { Theme } from "@/lib/constants";
import { useI18n } from "@/i18n/client";

const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

const segmentClass = (active: boolean) =>
  clsx(
    "grid min-h-8 min-w-8 place-items-center rounded-sm px-2 text-xs font-medium transition-colors",
    active ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
  );

export function ThemeSwitch({ current }: { current: Theme }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  return (
    <div role="radiogroup" aria-label={t("preferences.theme")} className="flex gap-0.5 rounded-md bg-surface-2 p-0.5" aria-busy={pending}>
      {(["system", "light", "dark"] as const).map((value) => {
        const Icon = THEME_ICONS[value];
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={current === value}
            aria-label={t(`preferences.themes.${value}`)}
            title={t(`preferences.themes.${value}`)}
            className={segmentClass(current === value)}
            onClick={() => start(() => setTheme(value))}
          >
            <Icon className="size-4" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

export function LocaleSwitch({ current }: { current: Locale }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  return (
    <div role="radiogroup" aria-label={t("preferences.language")} className="flex gap-0.5 rounded-md bg-surface-2 p-0.5" aria-busy={pending}>
      {LOCALES.map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={current === value}
          className={segmentClass(current === value)}
          onClick={() => start(() => setLocale(value))}
        >
          {value.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
