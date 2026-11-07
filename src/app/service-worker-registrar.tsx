"use client";

import { useEffect, useRef } from "react";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/i18n/client";
import { activateUpdate, registerServiceWorker } from "@/lib/sw-client";

/**
 * Meldet den Service Worker an (`public/sw.js`, P3-5) und weist auf eine neue Version hin: ein Hinweis mit „Neu laden“, der stehen bleibt, bis man ihn schließt oder
 * den Knopf drückt (`ToastInput.action`). Rendert selbst nichts. Wirkt nur im Betrieb und in einem sicheren Kontext (HTTPS oder `localhost`), siehe `lib/sw-client.ts`.
 * `version` kommt vom Server (`server/app-version.ts`) und steckt in der Adresse des Service Workers: ein Web-Update ergibt einen neuen.
 */
export function ServiceWorkerRegistrar({ version, production = process.env.NODE_ENV === "production" }: { version: string; /** nur für Tests: der Betriebsmodus (sonst aus dem Build) */ production?: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  // Der Hinweis nimmt die jeweils aktuelle Sprache; die Anmeldung beim Browser läuft nur einmal je Version
  const latest = useRef({ t, toast });
  useEffect(() => {
    latest.current = { t, toast };
  });

  useEffect(() => {
    void registerServiceWorker({
      version,
      env: {
        production,
        isSecureContext: window.isSecureContext,
        container: "serviceWorker" in navigator ? navigator.serviceWorker : undefined,
      },
      onUpdate: (worker) =>
        latest.current.toast.show({
          id: "sw-update",
          tone: "info",
          text: latest.current.t("pwa.updateReady"),
          action: { label: latest.current.t("pwa.updateReload"), onClick: () => activateUpdate(worker, navigator.serviceWorker, () => window.location.reload()) },
        }),
    });
  }, [version, production]);

  return null;
}
