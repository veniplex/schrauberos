import type { MetadataRoute } from "next";
import { PWA_BACKGROUND_COLOR, PWA_DESCRIPTION, PWA_ICONS, PWA_NAME, PWA_THEME_COLOR } from "@/lib/pwa";

/**
 * Web-App-Manifest (`/manifest.webmanifest`): macht die Anwendung auf dem Handy und Tablet installierbar (nur über HTTPS oder `localhost`, siehe README „Installierbare App (PWA)“).
 * Außerhalb des Proxys und **statisch** – ohne Datenbankzugriff (`lib/pwa.ts`). Start immer auf der Übersicht; ohne Sitzung leitet der Proxy auf die Anmeldung.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: PWA_NAME,
    short_name: PWA_NAME,
    description: PWA_DESCRIPTION,
    lang: "de",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: PWA_BACKGROUND_COLOR,
    theme_color: PWA_THEME_COLOR.light,
    categories: ["business", "productivity"],
    icons: PWA_ICONS.map((icon) => ({ ...icon })),
  };
}
