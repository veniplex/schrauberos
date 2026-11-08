import type { Translator } from "@/i18n/translate";

/** Prüfintervall als Text („5 Minuten“, „1 Stunde“) */
export function intervalText({ tp }: Pick<Translator, "tp">, seconds: number): string {
  return seconds >= 3600 && seconds % 3600 === 0 ? tp("network.monitor.intervalHours", seconds / 3600) : tp("network.monitor.intervalMinutes", Math.max(1, Math.round(seconds / 60)));
}

/** Dauer eines Ausfalls kurz („3 min“, „2 h 5 min“, „45 s“) */
export function durationText(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
