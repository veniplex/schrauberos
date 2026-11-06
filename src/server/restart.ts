import { RESTART_EXIT_CODE } from "@/lib/updates/state";

/** Beendet den Prozess kurz nach der Antwort an den Browser; der Launcher startet dann neu (Update, Wiederherstellung). */
export function scheduleRestart(delayMs = 1500): void {
  setTimeout(() => process.exit(RESTART_EXIT_CODE), delayMs);
}
