import { SegmentedLinks } from "@/components/ui/segmented";
import { getI18n } from "@/i18n/server";

/** Umschalter der Zeiterfassung: Heute und Woche, Einträge (mit Korrektur), Team (nur mit `time.viewAll`). */
export async function TimeTabs({ active, team }: { active: "today" | "entries" | "team"; team: boolean }) {
  const { t } = await getI18n();
  return (
    <SegmentedLinks
      label={t("time.title")}
      className="mb-5"
      options={[
        { href: "/time", label: t("time.tabs.today"), active: active === "today" },
        { href: "/time/entries", label: t("time.tabs.entries"), active: active === "entries" },
        ...(team ? [{ href: "/time/team", label: t("time.tabs.team"), active: active === "team" }] : []),
      ]}
    />
  );
}
