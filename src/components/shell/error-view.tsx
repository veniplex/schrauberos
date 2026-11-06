"use client";

import { useEffect } from "react";
import { unstable_isUnrecognizedActionError } from "next/navigation";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button, LinkButton } from "@/components/ui/buttons";
import { StatusPage } from "@/components/ui/status-page";
import { useI18n } from "@/i18n/client";
import { isStaleDeploymentError, mayAutoReload } from "@/lib/stale-deployment";

const RELOAD_KEY = "so-stale-reload";

/** Zeitpunkt des letzten automatischen Neuladens (sessionStorage kann fehlen oder werfen – dann gilt „noch nie“). */
function lastReload(): number | null {
  try {
    const value = Number(window.sessionStorage.getItem(RELOAD_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Inhalt der Fehlergrenzen (`error.tsx`). Ein offener Tab nach einem Web-Update ruft Server Actions auf, die der neue Server nicht
 * mehr kennt („Server Action nicht gefunden“): Das ist kein Fehler des Benutzers – die Seite lädt sich einmal neu (nicht in einer
 * Schleife) und passt dann wieder zum Server.
 */
export function ErrorView({ error, retry, fullscreen = false }: { error: unknown; retry: () => void; fullscreen?: boolean }) {
  const { t } = useI18n();
  const stale = isStaleDeploymentError(error) || unstable_isUnrecognizedActionError(error);
  const digest = typeof error === "object" && error !== null && "digest" in error ? String((error as { digest?: unknown }).digest ?? "") : "";

  useEffect(() => {
    if (!stale) {
      console.error(error);
      return;
    }
    if (!mayAutoReload(lastReload(), Date.now())) return;
    try {
      window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    } catch {
      /* ohne sessionStorage: nach dem Neuladen ist die Seite wieder passend, es gibt keine Schleife */
    }
    window.location.reload();
  }, [stale, error]);

  if (stale) {
    return (
      <StatusPage icon={RefreshCw} title={t("errors.staleTitle")} fullscreen={fullscreen} actions={<Button variant="primary" onClick={() => window.location.reload()}>{t("errors.reload")}</Button>}>
        {t("errors.staleText")}
      </StatusPage>
    );
  }
  return (
    <StatusPage
      icon={TriangleAlert}
      tone="danger"
      title={t("errors.errorTitle")}
      fullscreen={fullscreen}
      actions={
        <>
          <Button variant="primary" onClick={() => retry()}>
            {t("errors.retry")}
          </Button>
          <LinkButton href="/" external>
            {t("common.toDashboard")}
          </LinkButton>
        </>
      }
    >
      <p>{t("errors.errorText")}</p>
      {digest ? <p className="mt-2 font-mono text-xs">{t("errors.errorCode", { code: digest })}</p> : null}
    </StatusPage>
  );
}
