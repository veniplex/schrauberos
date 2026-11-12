import type { HolidayLookup } from "@/lib/holidays";
import { workdaysBetweenKeys } from "./domain";
import { FULL_WEEK, type WorkPattern } from "./work-pattern";

/**
 * Urlaubsanspruch, Übertrag und Rest (P4b-4) – rein, ohne Datenbank und ohne Uhr („heute“ kommt als Parameter).
 *
 * **Anspruch im Ein-/Austrittsjahr (monatsgenau, konservativ):** 1/12 des Jahresanspruchs je **vollem** Kalendermonat der Beschäftigung. Ein Monat zählt nur, wenn die Person ihn vom
 * ersten bis zum letzten Tag beschäftigt war (Eintritt am 1. zählt, Eintritt am 2. nicht; Austritt am letzten Tag zählt, am Vortag nicht). Gerundet wird wie in § 5 Abs. 2 BUrlG:
 * ein Bruchteil von mindestens einem halben Tag wird auf einen vollen Tag **aufgerundet**; ein kleinerer Bruchteil bleibt (auf zwei Nachkommastellen) bestehen. Vertragliche und
 * tarifliche Regelungen können abweichen. **Nicht abgebildet** sind die Wartezeit (voller Anspruch nach sechs Monaten) und die gesetzliche Sonderregel zum Austritt nach dem 30.6. (voller Anspruch): Hier
 * wird immer 1/12 je vollem Monat gerechnet. Ebenso nicht abgebildet ist die Mitwirkungs- und Hinweispflicht des Arbeitgebers (§ 7 BUrlG): Der Übertrag verfällt am Stichtag automatisch. Die Anwendung
 * liefert eine Übersicht, keine Rechtsberatung (die Hilfe sagt das ebenso).
 *
 * **Teilzeit:** Der Jahresanspruch ist der Anspruch in Arbeitstagen *dieser Person* (bei einer Dreitagewoche z. B. 18, nicht 30). Abgezogen werden nur Arbeitstage nach ihrem Muster
 * (`work-pattern.ts`), ohne Feiertage.
 *
 * **Übertrag:** Resturlaub eines Jahres geht ins nächste und verfällt dort am **Stichtag** (Standard 31.03.). Urlaub bis zum Stichtag wird zuerst vom Übertrag genommen. Der Übertrag
 * ergibt sich aus dem Vorjahr (Anspruch minus nicht aus dem Übertrag genommene Tage) – aber erst ab dem Jahr, in dem die Anwendung die Person kennt (`trackingStartYear`, das Jahr der Anlage):
 * Für frühere Jahre weiß sie nicht, wie viel Urlaub genommen wurde, und würde sonst den ganzen Anspruch als Rest übertragen. Dort trägt man den Resturlaub von Hand ein (`carry`). Gerechnet wird
 * höchstens sechs Jahre zurück.
 */

export type VacationRange = { start: string; end: string };

export type Entitlement = { days: number; months: number; prorated: boolean };

const pad = (n: number) => String(n).padStart(2, "0");
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Volle Kalendermonate des Jahres, in denen die Person vom ersten bis zum letzten Tag beschäftigt war (0–12). Eintritt/Austritt als `JJJJ-MM-TT` (Austritt: letzter Beschäftigungstag). */
export function employedMonths(year: number, hire: string | null, leave: string | null): number {
  let n = 0;
  for (let month = 1; month <= 12; month++) {
    const first = `${year}-${pad(month)}-01`;
    const last = `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`;
    if (hire && hire > first) continue;
    if (leave && leave < last) continue;
    n++;
  }
  return n;
}

/** Rundung des anteiligen Anspruchs (§ 5 Abs. 2 BUrlG): Bruchteil ≥ ½ Tag → voller Tag, sonst zwei Nachkommastellen. Ganzzahlig gerechnet (Zwölftel), also ohne Gleitkomma-Rauschen. */
export function proratedDays(daysPerYear: number, months: number): number {
  const numerator = daysPerYear * months;
  const whole = Math.floor(numerator / 12);
  const rest = numerator % 12;
  return rest >= 6 ? whole + 1 : r2(whole + rest / 12);
}

/** Anspruch des Jahres: der volle Jahresanspruch, im Ein-/Austrittsjahr anteilig (1/12 je vollem Monat), vor dem Eintritt und nach dem Austritt 0. `null` = kein Anspruch hinterlegt. */
export function yearEntitlement(input: { year: number; daysPerYear: number | null; hire: string | null; leave: string | null }): Entitlement | null {
  if (input.daysPerYear == null) return null;
  const months = employedMonths(input.year, input.hire, input.leave);
  const wholeYear = (!input.hire || input.hire <= `${input.year}-01-01`) && (!input.leave || input.leave >= `${input.year}-12-31`);
  return wholeYear ? { days: input.daysPerYear, months: 12, prorated: false } : { days: proratedDays(input.daysPerYear, months), months, prorated: true };
}

/** Überlappende oder aneinanderstoßende Zeiträume zusammenfassen (zwei sich überschneidende Urlaubseinträge zählen jeden Tag nur einmal). */
export function mergeRanges(ranges: readonly VacationRange[]): VacationRange[] {
  const sorted = ranges.filter((r) => r.end >= r.start).map((r) => ({ ...r })).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const out: VacationRange[] = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range.start <= last.end) {
      if (range.end > last.end) last.end = range.end;
    } else out.push(range);
  }
  return out;
}

export type VacationInput = {
  year: number;
  /** Jahresanspruch in Arbeitstagen der Person; `null` = nicht hinterlegt */
  daysPerYear: number | null;
  hire: string | null;
  leave: string | null;
  /** Jahr, ab dem die Anwendung die Person führt (Jahr der Anlage): davor wird kein Übertrag gerechnet, nur der von Hand erfasste gilt */
  trackingStartYear: number | null;
  /** Von Hand erfasster Resturlaub zu Beginn des Jahres `carry.year` (ersetzt dort die Rechnung) */
  carry: { year: number; days: number } | null;
  /** Urlaubseinträge (Art „Urlaub“) als Kalendertage */
  vacations: readonly VacationRange[];
  holidays?: HolidayLookup;
  pattern?: WorkPattern;
  /** Stichtag, an dem der Übertrag verfällt */
  deadline: { month: number; day: number };
  /** heute (Kalendertag `JJJJ-MM-TT`) */
  today: string;
};

export type VacationBalance = {
  year: number;
  /** Anspruch des Jahres (null: nicht hinterlegt) */
  entitlement: Entitlement | null;
  /** Übertrag aus dem Vorjahr zu Jahresbeginn */
  carryIn: number;
  /** davon bis zum Stichtag genommen */
  carryUsed: number;
  /** davon noch offen, verfällt am Stichtag (nur solange der Stichtag nicht vorbei ist) */
  carryOpen: number;
  /** davon verfallen (Stichtag vorbei) */
  carryExpired: number;
  /** Stichtag des Jahres (`JJJJ-MM-TT`) */
  deadline: string;
  /** genommene Urlaubstage im Jahr (Arbeitstage der Person ohne Feiertage) */
  used: number;
  /** noch verfügbar: Anspruch + noch offener Übertrag − genommen (negativ: mehr genommen als zustand) */
  remaining: number;
  /** Rest des Anspruchs zum Jahresende = Übertrag ins nächste Jahr */
  carryOut: number;
};

/** Stichtag im Jahr als `JJJJ-MM-TT` (ein 29. Februar fällt im Nichtschaltjahr auf den 28.). */
export function deadlineKey(year: number, deadline: { month: number; day: number }): string {
  return `${year}-${pad(deadline.month)}-${pad(Math.min(deadline.day, daysInMonth(year, deadline.month)))}`;
}

function oneYear(input: VacationInput, year: number, carryIn: number, ranges: readonly VacationRange[]): VacationBalance {
  const pattern = input.pattern ?? FULL_WEEK;
  const entitlement = yearEntitlement({ year, daysPerYear: input.daysPerYear, hire: input.hire, leave: input.leave });
  const first = `${year}-01-01`;
  const last = `${year}-12-31`;
  const deadline = deadlineKey(year, input.deadline);
  const within = (from: string, to: string) =>
    ranges.reduce((sum, r) => sum + workdaysBetweenKeys(r.start > from ? r.start : from, r.end < to ? r.end : to, input.holidays, pattern), 0);
  const used = within(first, last);
  const usedBefore = within(first, deadline);
  const carryUsed = Math.min(carryIn, usedBefore);
  const rest = carryIn - carryUsed;
  const entitled = entitlement?.days ?? 0;
  const remainingEntitlement = entitled - (used - carryUsed);
  const open = input.today <= deadline;
  return {
    year,
    entitlement,
    carryIn: r2(carryIn),
    carryUsed: r2(carryUsed),
    carryOpen: r2(open ? rest : 0),
    carryExpired: r2(open ? 0 : rest),
    deadline,
    used: r2(used),
    remaining: r2(remainingEntitlement + (open ? rest : 0)),
    carryOut: r2(Math.max(0, remainingEntitlement)),
  };
}

/** Rest und Übertrag eines Jahres (rechnet die Vorjahre mit, höchstens sechs). */
export function vacationBalance(input: VacationInput): VacationBalance {
  const ranges = mergeRanges(input.vacations);
  const hireYear = input.hire ? Number(input.hire.slice(0, 4)) : null;
  // Ab wann gerechnet wird: nicht vor dem Eintritt, nicht vor dem Jahr der Anlage – es sei denn, ein von Hand erfasster Übertrag liegt davor und beginnt die Rechnung
  const tracked = Math.min(input.trackingStartYear ?? Number.NEGATIVE_INFINITY, input.carry?.year ?? Number.POSITIVE_INFINITY);
  const start = Math.max(input.year - 6, hireYear ?? Number.NEGATIVE_INFINITY, tracked);
  let carry = 0;
  for (let y = start; y < input.year; y++) {
    const cin = input.carry?.year === y ? input.carry.days : carry;
    carry = oneYear(input, y, cin, ranges).carryOut;
  }
  const carryIn = input.carry?.year === input.year ? input.carry.days : carry;
  return oneYear(input, input.year, carryIn, ranges);
}
