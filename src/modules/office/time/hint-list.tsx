import { Alert } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { noon } from "@/lib/dates";
import { formatDuration, type TimeHint } from "./domain";

/**
 * Pausen-/Ruhezeit-Hinweise als ruhige Liste (nie eine Sperre, nie eine Bestätigung). Die Schwellen und der Vorbehalt „Hinweis, keine Rechtsberatung“ stehen in `HINT_RULES` und in der Hilfe.
 */
export async function HintList({ hints }: { hints: readonly TimeHint[] }) {
  const { t, date } = await getI18n();
  if (hints.length === 0) return null;
  return (
    <Alert tone="info" className="flex flex-col gap-2">
      <p className="font-medium">{t("time.hints.title")}</p>
      <ul className="flex flex-col gap-1 text-sm">
        {hints.map((hint, i) => {
          const day = date(noon(hint.day), { dateStyle: "medium" });
          const text =
            hint.kind === "break"
              ? t("time.hints.break", { day, worked: formatDuration(hint.worked), pause: hint.pause, needed: hint.needed })
              : hint.kind === "maxDay"
                ? t("time.hints.maxDay", { day, worked: formatDuration(hint.worked) })
                : hint.kind === "rest"
                  ? t("time.hints.rest", { day, rest: formatDuration(hint.rest) })
                  : t("time.hints.forgotten", { day, duration: formatDuration(hint.minutes) });
          return <li key={`${hint.kind}-${hint.day}-${i}`}>{text}</li>;
        })}
      </ul>
      <p className="text-xs text-ink-muted">{t("time.hints.disclaimer")}</p>
    </Alert>
  );
}
