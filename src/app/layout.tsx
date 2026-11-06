import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { NavProgress } from "@/components/ui/nav-progress";
import { I18nProvider } from "@/i18n/client";
import { getLocale, getMessages, getTheme } from "@/i18n/server";
import { contrastInk, isHexColor } from "@/lib/color";
import { startupState } from "@/server/startup-state";
import { getWorkshop } from "@/server/workshop";
import { ReinstallNotice } from "./reinstall-notice";

export async function generateMetadata(): Promise<Metadata> {
  if (startupState().status === "reinstall") return { title: "SchrauberOS", robots: { index: false, follow: false } };
  const workshop = await getWorkshop();
  return {
    title: { default: workshop.name, template: `%s · ${workshop.name}` },
    description: "Werkstatt-Dashboard",
    robots: { index: false, follow: false },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Fremde Datenbank (Volume einer nicht verträglichen Version): keine Seite fasst sie an, nur der Hinweis wird gezeigt
  if (startupState().status === "reinstall") {
    return (
      <html lang="de" className={`${GeistSans.variable} ${GeistMono.variable}`}>
        <body>
          <ReinstallNotice />
        </body>
      </html>
    );
  }
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
        <NavProgress />
        <I18nProvider locale={locale} messages={messages}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
