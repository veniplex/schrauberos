/**
 * Die Töne einer Zustandsmarke (`StatusBadge`). Konvention: grün = in Ordnung/erledigt, gelb = Aufmerksamkeit/bald fällig, rot = Fehler/überfällig/abgelaufen,
 * blau = Information/in Arbeit, grau = neutral/inaktiv, Akzent = Kennzeichnung. Die Zuordnung Zustand → Ton liegt bei der Funktion (`status-tone.ts`).
 */
export const STATUS_TONES = ["neutral", "success", "warning", "danger", "info", "accent"] as const;
export type StatusTone = (typeof STATUS_TONES)[number];
