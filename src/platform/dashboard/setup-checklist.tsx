import { Circle, CircleCheck } from "lucide-react";
import { Badge, Card, TextLink } from "@/components/ui/layout";
import { SubmitButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
import type { MessageKey } from "@/i18n/translate";
import { checklistProgress } from "@/lib/dashboard";
import { setSetupChecklistHidden } from "./actions";

export type ChecklistItem = { id: string; labelKey: MessageKey; hintKey: MessageKey; href: string; recommended: boolean; done: boolean };

/**
 * Einrichtungs-Checkliste auf der Übersicht der Administration (P2b-4). Die Punkte kommen von den aktiven Funktionen (`setupChecksFor`) und rechnen sich aus dem Stand der Daten –
 * nichts wird von Hand abgehakt. Offene Punkte stehen oben (Pflicht vor Empfehlung), erledigte darunter; „Ausblenden“ schließt die Karte für die ganze Werkstatt (Einstellung, Audit),
 * sie lässt sich unten auf der Übersicht wieder einblenden. Sind alle Punkte erledigt, wird aus dem Knopf „Fertig – Checkliste ausblenden“.
 */
export async function SetupChecklist({ items }: { items: ChecklistItem[] }) {
  if (items.length === 0) return null;
  const { t } = await getI18n();
  const progress = checklistProgress(items);
  const ordered = [...progress.open, ...items.filter((i) => i.done)];
  return (
    <Card headingLevel={2} title={t("dashboard.setup.title")} actions={<span className="text-sm text-ink-muted">{t("dashboard.setup.progress", { done: progress.done, total: progress.total })}</span>} className="mb-6">
      <p className="mb-3 text-sm text-ink-muted">{progress.complete ? t("dashboard.setup.allDone") : t("dashboard.setup.intro")}</p>
      <ul className="divide-y divide-line">
        {ordered.map((item) => (
          <li key={item.id} className="flex items-start gap-3 py-2.5">
            {item.done ? <CircleCheck className="mt-0.5 size-5 shrink-0 text-success-ink" aria-hidden /> : <Circle className="mt-0.5 size-5 shrink-0 text-ink-muted" aria-hidden />}
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <TextLink href={item.href} className={item.done ? "text-ink-muted" : undefined}>
                  {t(item.labelKey)}
                </TextLink>
                <span className="sr-only">{item.done ? t("dashboard.setup.done") : t("dashboard.setup.open")}</span>
                {item.recommended && !item.done ? <Badge>{t("dashboard.setup.recommended")}</Badge> : null}
              </p>
              {item.done ? null : <p className="mt-0.5 text-xs text-ink-muted">{t(item.hintKey)}</p>}
            </div>
          </li>
        ))}
      </ul>
      <form action={setSetupChecklistHidden} className="mt-3 flex justify-end">
        <input type="hidden" name="hidden" value="true" />
        <SubmitButton variant={progress.complete ? "primary" : "ghost"} size="sm">
          {progress.complete ? t("dashboard.setup.finish") : t("dashboard.setup.hide")}
        </SubmitButton>
      </form>
    </Card>
  );
}

/** Wieder einblenden (nur Administratoren, wenn die Karte ausgeblendet ist) – klein, am Ende der Übersicht. */
export async function ShowSetupChecklist() {
  const { t } = await getI18n();
  return (
    <form action={setSetupChecklistHidden} className="mt-8">
      <input type="hidden" name="hidden" value="false" />
      <SubmitButton variant="ghost" size="sm">
        {t("dashboard.setup.show")}
      </SubmitButton>
    </form>
  );
}
