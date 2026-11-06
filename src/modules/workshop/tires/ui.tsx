import { Badge } from "@/components/ui/layout";
import type { Translator } from "@/i18n/translate";
import type { Health } from "@/modules/workshop/tires/domain";

const TONE = { ok: "success", warn: "warning", replace: "danger", unknown: "neutral" } as const;

export function HealthBadge({ health, t }: { health: Health; t: Translator["t"] }) {
  return <Badge tone={TONE[health]}>{t(`enums.health.${health}`)}</Badge>;
}

const SEASON_TONE = { summer: "warning", winter: "info", allseason: "neutral" } as const;

export function SeasonBadge({ season, td }: { season: string; td: Translator["td"] }) {
  return <Badge tone={SEASON_TONE[season as keyof typeof SEASON_TONE] ?? "neutral"}>{td(`enums.season.${season}`, season)}</Badge>;
}
