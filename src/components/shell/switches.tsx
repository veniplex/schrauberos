"use client";

import { useTransition } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { setLocale, setTheme } from "@/server/actions/preferences";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/config";
import type { Theme } from "@/lib/constants";
import { useI18n } from "@/i18n/client";
import { SegmentedControl } from "@/components/ui/segmented";

/** Ein Wert als Formularfeld (die Aktionen des Aktions-Rahmens nehmen `FormData`). */
function fieldForm(name: string, value: string): FormData {
  const data = new FormData();
  data.set(name, value);
  return data;
}

const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

export function ThemeSwitch({ current }: { current: Theme }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  return (
    <SegmentedControl
      label={t("preferences.theme")}
      value={current}
      busy={pending}
      onChange={(value) => start(() => setTheme(fieldForm("theme", value)))}
      options={(["system", "light", "dark"] as const).map((value) => {
        const Icon = THEME_ICONS[value];
        return { value, title: t(`preferences.themes.${value}`), label: <Icon className="size-4" aria-hidden /> };
      })}
    />
  );
}

export function LocaleSwitch({ current }: { current: Locale }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  return (
    <SegmentedControl
      label={t("preferences.language")}
      value={current}
      busy={pending}
      onChange={(value) => start(() => setLocale(fieldForm("locale", value)))}
      options={LOCALES.map((value) => ({ value, label: value.toUpperCase(), title: LOCALE_LABELS[value], lang: value }))}
    />
  );
}
