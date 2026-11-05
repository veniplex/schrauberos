import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { I18nProvider } from "@/i18n/client";
import { getLocale, getMessages, getTheme } from "@/i18n/server";
import { contrastInk, isHexColor } from "@/lib/color";
import { getWorkshop } from "@/server/workshop";

export async function generateMetadata(): Promise<Metadata> {
  const workshop = await getWorkshop();
  return {
    title: { default: workshop.name, template: `%s · ${workshop.name}` },
    description: "Werkstatt-Dashboard",
    robots: { index: false, follow: false },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [locale, messages, theme, workshop] = await Promise.all([getLocale(), getMessages(), getTheme(), getWorkshop()]);
  const accent = isHexColor(workshop.accentColor) ? workshop.accentColor : "#2459c9";

  return (
    <html
      lang={locale}
      data-theme={theme === "system" ? undefined : theme}
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      style={{ "--workshop-accent": accent, "--workshop-accent-contrast": contrastInk(accent) } as CSSProperties}
    >
      <body>
        <I18nProvider locale={locale} messages={messages}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
