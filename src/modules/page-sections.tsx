import type { ReactNode } from "react";
import { WidgetBoundary } from "@/components/shell/widget-boundary";
import type { AppSession } from "@/server/auth/session";
import { sectionsFor } from "./registry";
import type { SectionHost } from "./types";

/**
 * Rendert die Beiträge anderer Funktionen an einem Erweiterungspunkt (`SectionHost`): jeder in einer eigenen Fehlergrenze, damit ein werfender Abschnitt die Seite nicht mitnimmt.
 * Der Gastgeber (Auftragsseite, Terminansicht) ruft nur dies auf und kennt seine Gäste nicht. Ohne Beitrag entsteht nichts.
 */
export async function PageSections({ session, host, entityId, wrap }: { session: AppSession; host: SectionHost; entityId: string; wrap?: (children: ReactNode) => ReactNode }) {
  const sections = sectionsFor(session, host);
  if (sections.length === 0) return null;
  const content = sections.map((section) => (
    <WidgetBoundary key={section.id}>
      <section.Component entityId={entityId} session={session} />
    </WidgetBoundary>
  ));
  return <>{wrap ? wrap(content) : content}</>;
}
