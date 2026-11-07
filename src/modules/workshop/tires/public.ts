/**
 * Öffentliche Schnittstelle der Funktion workshop.tires. Andere Funktionen importieren NUR aus dieser Datei
 * (und nur, wenn sie die Funktion in `requires`/`uses` ihrer feature.ts deklariert haben).
 */
export { formatTireSize, setHealth, suggestedStockStatus, tireHealth, type TireRules } from "./domain";
export { getTireRules } from "./settings";
export { TireStockPrompt } from "./stock-prompt";
export { HealthBadge, SeasonBadge } from "./ui";
