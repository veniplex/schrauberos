import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import type { CSSProperties, ReactNode } from "react";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { NavProgress } from "@/components/ui/nav-progress";
import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider } from "@/i18n/client";
import { getLocale, getMessages, getTheme } from "@/i18n/server";
import { contrastInk, isHexColor } from "@/lib/color";
import { startupState } from "@/server/startup-state";
import { getWorkshop } from "@/server/workshop";
import { ReinstallNotice } from "./reinstall-notice";

/** `viewport-fit=cover`: Die Safe-Area (Notch, Home-Balken) ist nutzbar – Kopfzeile, Seitenfach, Toast und Aktionsleiste berücksichtigen sie über `env(safe-area-inset-*)`. */
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

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
  // Der Nonce der Content-Security-Policy gehört zur einzelnen Anfrage (der Proxy erzeugt ihn, Next trägt ihn beim Rendern in alle Skripte ein): Jede Seite – auch
  // „Nicht gefunden“, „Kein Zugriff“ und die Fehlerseiten, die alle in diesem Layout rendern – muss je Anfrage gerendert werden, nie beim Build. Die App ist ohnehin dynamisch
  // (Cookies, Datenbank); diese Zeile hält es auch dann fest, wenn einmal nichts davon mehr gelesen würde.
  await connection();
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
        <I18nProvider locale={locale} messages={messages}>
          <NavProgress />
          <ToastProvider>{children}</ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
