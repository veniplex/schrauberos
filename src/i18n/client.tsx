"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Locale } from "./config";
import type { Messages } from "./messages/de";
import { createTranslator, type Translator } from "./translate";

const I18nContext = createContext<Translator | null>(null);

export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: Messages;
  children: ReactNode;
}) {
  const translator = useMemo(() => createTranslator(locale, messages), [locale, messages]);
  return <I18nContext.Provider value={translator}>{children}</I18nContext.Provider>;
}

export function useI18n(): Translator {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n muss innerhalb von <I18nProvider> verwendet werden.");
  return ctx;
}
