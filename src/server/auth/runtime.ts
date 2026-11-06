/**
 * Uhr, Zufall und Warten der Anmeldung an einer Stelle – Tests ersetzen sie, damit Wartezeiten von 90 Sekunden nicht
 * wirklich abgewartet werden müssen. Im Betrieb ist es die echte Zeit. (Ohne `server-only`: reine Hilfsfunktionen.)
 */
export const authRuntime = {
  now: (): number => Date.now(),
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
  random: (): number => Math.random(),
  /** Zufällige Wartezeit zwischen min und max ms */
  between(min: number, max: number): number {
    return Math.round(min + this.random() * (max - min));
  },
};
