import { StatusBadge } from "@/components/ui/layout";
import type { Translator } from "@/i18n/translate";
import type { Health } from "@/modules/workshop/tires/domain";
import { HEALTH_TONE, SEASON_TONE } from "@/modules/workshop/tires/status-tone";
import type { TireSeason } from "@/modules/workshop/tires/constants";

export function HealthBadge({ health, t }: { health: Health; t: Translator["t"] }) {
  return <StatusBadge tone={HEALTH_TONE[health]}>{t(`enums.health.${health}`)}</StatusBadge>;
}

export function SeasonBadge({ season, td }: { season: string; td: Translator["td"] }) {
  return <StatusBadge tone={SEASON_TONE[season as TireSeason] ?? "neutral"}>{td(`enums.season.${season}`, season)}</StatusBadge>;
}
