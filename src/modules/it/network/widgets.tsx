import { Alert, Card, TextLink } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import type { WidgetDef } from "@/modules/types";
import { monitorSummary } from "./queries";

/**
 * Baustein „Netzwerk-Status“: **nur Gemessenes**. Ist die Überwachung aus, steht dort „ausgeschaltet“ (gibt es dazu noch gar kein Ziel, erscheint der Baustein nicht), ohne Ziel „nicht eingerichtet“ – kein erfundener Zustand. Er nennt die Namen
 * nicht erreichbarer Ziele (Bezeichnungen, nie Adressen) und verweist auf die Überwachung.
 */
async function NetworkStatusWidget() {
  const { t } = await getI18n();
  const s = await monitorSummary(new Date());
  // Ungenutzt (ausgeschaltet und keine Ziele): kein Dauerhinweis auf dem Dashboard
  if (!s.enabled && s.targets === 0) return null;
  return (
    <Card
      headingLevel={3}
      title={t("network.monitor.widget.title")}
      actions={
        <TextLink href="/network/monitoring" className="text-sm">
          {t("network.monitor.widget.open")}
        </TextLink>
      }
    >
      {!s.enabled ? (
        <p className="text-sm text-ink-muted">{t("network.monitor.widget.off")}</p>
      ) : s.targets === 0 ? (
        <p className="text-sm text-ink-muted">{t("network.monitor.notConfigured")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {s.down > 0 ? (
            <Alert tone="danger">
              {t("network.monitor.widget.someDown")} {s.downNames.slice(0, 5).join(", ")}
              {s.downNames.length > 5 ? " …" : ""}
            </Alert>
          ) : s.warn === 0 && s.unknown === 0 ? (
            <p className="text-sm">{t("network.monitor.widget.allUp", { count: s.up })}</p>
          ) : null}
          <p className="text-sm text-ink-muted">{t("network.monitor.widget.counts", { up: s.up, warn: s.warn, down: s.down, unknown: s.unknown })}</p>
        </div>
      )}
    </Card>
  );
}

/** Dashboard-Bausteine dieser Funktion. Der frühere Baustein mit erfundenen Werten ist entfernt; dieser zeigt ausschließlich die Messungen der Überwachung. */
export const widgets: WidgetDef[] = [
  { id: "network-status", titleKey: "network.monitor.widget.title", priority: 75, feature: "it.network", permission: "network.view", span: 1, order: 95, Component: NetworkStatusWidget },
];
