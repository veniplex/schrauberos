/**
 * Zeiträume für den Export (Steuerberater …): Voreinstellungen relativ zu einem Tag. Reine Kalenderrechnung mit `JJJJ-MM-TT`-Texten (keine Uhr, keine Zeitzone) –
 * `today` kommt von außen.
 */
export type PeriodPreset = "thisYear" | "lastYear" | "lastQuarter" | "lastMonth";
export type Period = { from: string; to: string };

const pad = (n: number) => String(n).padStart(2, "0");
/** Letzter Tag eines Monats (1–12). */
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

export function presetPeriod(preset: PeriodPreset, today: string): Period {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  switch (preset) {
    case "thisYear":
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    case "lastYear":
      return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
    case "lastQuarter": {
      // Quartal vor dem laufenden: Januar–März → Oktober–Dezember des Vorjahres
      const current = Math.floor((month - 1) / 3);
      const quarter = current === 0 ? 3 : current - 1;
      const y = current === 0 ? year - 1 : year;
      const startMonth = quarter * 3 + 1;
      return { from: `${y}-${pad(startMonth)}-01`, to: `${y}-${pad(startMonth + 2)}-${pad(lastDay(y, startMonth + 2))}` };
    }
    case "lastMonth": {
      const y = month === 1 ? year - 1 : year;
      const m = month === 1 ? 12 : month - 1;
      return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}` };
    }
  }
}
