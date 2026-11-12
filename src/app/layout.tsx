import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import type { CSSProperties, ReactNode } from "react";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { FocusRescue } from "@/components/ui/focus-rescue";
import { NavProgress } from "@/components/ui/nav-progress";
import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider } from "@/i18n/client";
import { getLocale, getMessages, getTheme } from "@/i18n/server";
import { contrastInk, isHexColor } from "@/lib/color";
import { PWA_APPLE_ICON, PWA_NAME, PWA_THEME_COLOR } from "@/lib/pwa";
import { startupState } from "@/server/startup-state";
import { appVersion } from "@/server/app-version";
import { getWorkshop } from "@/server/workshop";
import { ReinstallNotice } from "./reinstall-notice";
import { ServiceWorkerRegistrar } from "./service-worker-registrar";

/** `viewport-fit=cover`: Die Safe-Area (Notch, Home-Balken) ist nutzbar – Kopfzeile, Seitenfach, Toast und Aktionsleiste berücksichtigen sie über `env(safe-area-inset-*)`. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Farbe der Statusleiste/Titelleiste der installierten App und mobiler Browser: die Fläche der Kopfzeile, je nach Hell/Dunkel des Geräts (Werte der Tokens, `lib/pwa.ts`)
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: PWA_THEME_COLOR.light },
    { media: "(prefers-color-scheme: dark)", color: PWA_THEME_COLOR.dark },
  ],
};

export async function generateMetadata(): Promise<Metadata> {
  if (startupState().status === "reinstall") return { title: "SchrauberOS", robots: { index: false, follow: false } };
  const workshop = await getWorkshop();
  return {
    title: { default: workshop.name, template: `%s · ${workshop.name}` },
    description: "Werkstatt-Dashboard",
    robots: { index: false, follow: false },
    // Installierte App (P3-5): das Manifest liefert `manifest.ts` selbst; iOS braucht das Symbol und den Namen als Metaangaben
    applicationName: PWA_NAME,
    icons: { apple: PWA_APPLE_ICON },
    appleWebApp: { capable: true, title: workshop.name, statusBarStyle: "default" },
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
          <FocusRescue />
          <ToastProvider>
            {children}
            <ServiceWorkerRegistrar version={appVersion()} />
          </ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
