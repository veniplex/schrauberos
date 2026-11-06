import { SearchX } from "lucide-react";
import { LinkButton } from "@/components/ui/buttons";
import { StatusPage } from "@/components/ui/status-page";
import { getI18n } from "@/i18n/server";

/** Inhalt der Seite „nicht gefunden“ – mit Link zur Übersicht (und zur Hilfe). */
export async function NotFoundContent({ fullscreen = false, withHelp = true }: { fullscreen?: boolean; withHelp?: boolean }) {
  const { t } = await getI18n();
  return (
    <StatusPage
      icon={SearchX}
      title={t("errors.notFoundTitle")}
      fullscreen={fullscreen}
      actions={
        <>
          <LinkButton href="/" variant="primary">
            {t("common.toDashboard")}
          </LinkButton>
          {withHelp ? <LinkButton href="/help">{t("nav.help")}</LinkButton> : null}
        </>
      }
    >
      {t("errors.notFoundText")}
    </StatusPage>
  );
}
