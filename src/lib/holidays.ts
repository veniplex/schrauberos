import { addDaysToKey, dayKey, isCalendarDay, weekdayOfKey, workshopZone } from "./zone";

/**
 * Gesetzliche Feiertage (P4b-0) – rein, ohne Datenbank und ohne Uhr. Der Datenbestand sind **Regeln** (fester Tag, Abstand zu Ostern, Sonderfälle), keine Jahreslisten:
 * Deutschland (16 Länder), Österreich (9 Bundesländer) und die Schweiz (26 Kantone). Eine Region ist ein Code wie `DE-NW`, `AT-9` oder `CH-ZH`; `""` heißt „keine Feiertage“.
 *
 * Die Werkstatt pflegt darüber (Einstellungen → Feiertage): gesetzliche Tage der Region **streichen**, zum **halben Tag** machen oder (bei den nur regional geltenden Landesfeiertagen
 * Österreichs, die nicht gesetzlich arbeitsfrei sind) **einschalten**, dazu **eigene Tage** (Betriebsferien, Brückentage, Rosenmontag …; einmalig mit Jahr oder jedes Jahr).
 *
 * Tage sind Kalendertage `JJJJ-MM-TT` (siehe `zone.ts`); `holidayOnDate` übersetzt einen Zeitpunkt über die Zone der Werkstatt. Die Daten der Schweiz und der Länder folgen den
 * üblichen Zusammenstellungen und sind ein Vorschlag: Kantone und Gemeinden regeln Einzelheiten (halbe Tage, Gemeindefeiertage) unterschiedlich, deshalb ist alles pflegbar.
 */

/* ───────────── Ostern ───────────── */

/** Ostersonntag nach Meeus/Jones/Butcher (der „Spencer-Algorithmus“) für den gregorianischen Kalender; Monat 3 oder 4. */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/** Ostersonntag nach der Gaußschen Osterformel (mit den beiden Sonderregeln für den 26. April und den 25. April); zur Gegenprobe der anderen Berechnung. */
export function easterSundayGauss(year: number): { month: number; day: number } {
  const k = Math.floor(year / 100);
  const p = Math.floor((13 + 8 * k) / 25);
  const q = Math.floor(k / 4);
  const M = (15 - p + k - q) % 30;
  const N = (4 + k - q) % 7;
  const a = year % 19;
  const b = year % 4;
  const c = year % 7;
  const d = (19 * a + M) % 30;
  const e = (2 * b + 4 * c + 6 * d + N) % 7;
  let day = 22 + d + e; // Tag im März; über 31 → April
  let month = 3;
  if (day > 31) {
    month = 4;
    day -= 31;
  }
  if (month === 4 && day === 26) day = 19;
  else if (month === 4 && day === 25 && d === 28 && e === 6 && a > 10) day = 18;
  return { month, day };
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");
export const ymd = (year: number, month: number, day: number): string => `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

/** Ostersonntag des Jahres als Kalendertag. */
export function easterKey(year: number): string {
  const { month, day } = easterSunday(year);
  return ymd(year, month, day);
}

/* ───────────── Regeln ───────────── */

export type Country = "DE" | "AT" | "CH";

/** Datum einer Regel in einem Jahr; `easter` ist der Ostersonntag des Jahres. */
type When = { fixed: [month: number, day: number] } | { easter: number } | { rule: (year: number, easter: string) => string };

type Rule = {
  /** Kennung ohne Land; Beschriftung unter `holidays.names.<key>` */
  key: string;
  when: When;
  /** Regionen (ohne Länderpräfix), in denen die Regel gilt; `"all"` = überall im Land */
  regions: "all" | readonly string[];
  /** Nur ein Vorschlag, kein gesetzlicher Feiertag (Landesfeiertage Österreichs): aus, solange er nicht eingeschaltet ist */
  optional?: boolean;
  /** Gilt in diesen Regionen nur in Teilen (Gemeinden mit überwiegend katholischer Bevölkerung o. Ä.) */
  partialIn?: readonly string[];
};

const split = (s: string): readonly string[] => s.split(/\s+/).filter(Boolean);

/** n-ter Wochentag (0 = Sonntag) eines Monats */
function nthWeekday(year: number, month: number, nth: number, weekday: number): string {
  const first = ymd(year, month, 1);
  const shift = (weekday - weekdayOfKey(first) + 7) % 7;
  return addDaysToKey(first, shift + (nth - 1) * 7);
}

const DE_RULES: readonly Rule[] = [
  { key: "newYear", when: { fixed: [1, 1] }, regions: "all" },
  { key: "goodFriday", when: { easter: -2 }, regions: "all" },
  { key: "easterMonday", when: { easter: 1 }, regions: "all" },
  { key: "labourDay", when: { fixed: [5, 1] }, regions: "all" },
  { key: "ascension", when: { easter: 39 }, regions: "all" },
  { key: "whitMonday", when: { easter: 50 }, regions: "all" },
  { key: "germanUnity", when: { fixed: [10, 3] }, regions: "all" },
  { key: "christmasDay", when: { fixed: [12, 25] }, regions: "all" },
  { key: "secondChristmasDay", when: { fixed: [12, 26] }, regions: "all" },
  { key: "epiphany", when: { fixed: [1, 6] }, regions: split("BW BY ST") },
  { key: "womensDay", when: { fixed: [3, 8] }, regions: split("BE MV") },
  { key: "easterSunday", when: { easter: 0 }, regions: split("BB") },
  { key: "pentecostSunday", when: { easter: 49 }, regions: split("BB") },
  { key: "corpusChristi", when: { easter: 60 }, regions: split("BW BY HE NW RP SL") },
  { key: "assumption", when: { fixed: [8, 15] }, regions: split("SL BY"), partialIn: ["BY"] },
  { key: "worldChildrensDay", when: { fixed: [9, 20] }, regions: split("TH") },
  { key: "reformationDay", when: { fixed: [10, 31] }, regions: split("BB HB HH MV NI SN ST SH TH") },
  { key: "allSaints", when: { fixed: [11, 1] }, regions: split("BW BY NW RP SL") },
  // Mittwoch vor dem 23. November
  { key: "repentanceDay", when: { rule: (year) => addDaysToKey(ymd(year, 11, 23), -(((weekdayOfKey(ymd(year, 11, 23)) - 3 + 7) % 7) || 7)) }, regions: split("SN") },
];

const AT_RULES: readonly Rule[] = [
  { key: "newYear", when: { fixed: [1, 1] }, regions: "all" },
  { key: "epiphany", when: { fixed: [1, 6] }, regions: "all" },
  { key: "easterMonday", when: { easter: 1 }, regions: "all" },
  { key: "labourDay", when: { fixed: [5, 1] }, regions: "all" },
  { key: "ascension", when: { easter: 39 }, regions: "all" },
  { key: "whitMonday", when: { easter: 50 }, regions: "all" },
  { key: "corpusChristi", when: { easter: 60 }, regions: "all" },
  { key: "assumption", when: { fixed: [8, 15] }, regions: "all" },
  { key: "austrianNationalDay", when: { fixed: [10, 26] }, regions: "all" },
  { key: "allSaints", when: { fixed: [11, 1] }, regions: "all" },
  { key: "immaculateConception", when: { fixed: [12, 8] }, regions: "all" },
  { key: "christmasDay", when: { fixed: [12, 25] }, regions: "all" },
  { key: "secondChristmasDay", when: { fixed: [12, 26] }, regions: "all" },
  // Landesfeiertage: nicht gesetzlich arbeitsfrei (nur Vorschläge, einschaltbar)
  { key: "stJoseph", when: { fixed: [3, 19] }, regions: split("2 6 7 8"), optional: true },
  { key: "stFlorian", when: { fixed: [5, 4] }, regions: split("4"), optional: true },
  { key: "stRupert", when: { fixed: [9, 24] }, regions: split("5"), optional: true },
  { key: "stMartin", when: { fixed: [11, 11] }, regions: split("1"), optional: true },
  { key: "stLeopold", when: { fixed: [11, 15] }, regions: split("3 9"), optional: true },
];

const ALL_CANTONS = split("AG AI AR BE BL BS FR GE GL GR JU LU NE NW OW SG SH SO SZ TG TI UR VD VS ZG ZH");
const except = (list: readonly string[], ...out: string[]) => list.filter((c) => !out.includes(c));

const CH_RULES: readonly Rule[] = [
  { key: "newYear", when: { fixed: [1, 1] }, regions: "all" },
  { key: "berchtoldsDay", when: { fixed: [1, 2] }, regions: split("AG BE FR GL JU LU OW SH SO TG VD ZG ZH") },
  { key: "epiphany", when: { fixed: [1, 6] }, regions: split("UR SZ TI") },
  { key: "stJoseph", when: { fixed: [3, 19] }, regions: split("UR SZ NW TI VS") },
  { key: "republicDayNE", when: { fixed: [3, 1] }, regions: split("NE") },
  { key: "goodFriday", when: { easter: -2 }, regions: except(ALL_CANTONS, "TI", "VS") },
  { key: "easterMonday", when: { easter: 1 }, regions: except(ALL_CANTONS, "VS") },
  // Näfelser Fahrt: erster Donnerstag im April, in der Karwoche am Donnerstag nach Ostern
  {
    key: "nafelserFahrt",
    when: {
      rule: (year, easter) => {
        const thursday = nthWeekday(year, 4, 1, 4);
        return thursday >= addDaysToKey(easter, -6) && thursday <= easter ? addDaysToKey(easter, 4) : thursday;
      },
    },
    regions: split("GL"),
  },
  { key: "labourDay", when: { fixed: [5, 1] }, regions: split("BL BS JU NE SH TI ZH") },
  { key: "ascension", when: { easter: 39 }, regions: "all" },
  { key: "whitMonday", when: { easter: 50 }, regions: except(ALL_CANTONS, "VS") },
  { key: "corpusChristi", when: { easter: 60 }, regions: split("AI FR JU LU NW OW SZ TI UR VS ZG") },
  { key: "independenceJU", when: { fixed: [6, 23] }, regions: split("JU") },
  { key: "stPeterPaul", when: { fixed: [6, 29] }, regions: split("TI") },
  { key: "swissNationalDay", when: { fixed: [8, 1] }, regions: "all" },
  { key: "assumption", when: { fixed: [8, 15] }, regions: split("AI FR JU LU NW OW SZ TI UR VS ZG") },
  // Genfer Bettag: Donnerstag nach dem ersten Sonntag im September; Lundi du Jeûne: Montag nach dem dritten Sonntag
  { key: "jeuneGeneve", when: { rule: (year) => addDaysToKey(nthWeekday(year, 9, 1, 0), 4) }, regions: split("GE") },
  { key: "lundiJeune", when: { rule: (year) => addDaysToKey(nthWeekday(year, 9, 3, 0), 1) }, regions: split("VD NE") },
  { key: "allSaints", when: { fixed: [11, 1] }, regions: split("AI FR GL JU LU NW OW SG SZ TI UR VS ZG") },
  { key: "immaculateConception", when: { fixed: [12, 8] }, regions: split("AI FR LU NW OW SZ TI UR VS ZG") },
  { key: "christmasDay", when: { fixed: [12, 25] }, regions: "all" },
  { key: "secondChristmasDay", when: { fixed: [12, 26] }, regions: split("AG AI AR BE BL BS FR GL GR JU LU NW OW SG SH SO SZ TG TI UR ZG ZH") },
  { key: "restorationGE", when: { fixed: [12, 31] }, regions: split("GE") },
];

const RULES: Record<Country, readonly Rule[]> = { DE: DE_RULES, AT: AT_RULES, CH: CH_RULES };

const REGION_CODES: Record<Country, readonly string[]> = {
  DE: split("BW BY BE BB HB HH HE MV NI NW RP SL SN ST SH TH"),
  AT: split("1 2 3 4 5 6 7 8 9"),
  CH: ALL_CANTONS,
};

export const COUNTRIES: readonly Country[] = ["DE", "AT", "CH"];

/** Alle Regionen eines Landes als Codes (`DE-NW`); Beschriftung unter `holidays.regions.<code>`. */
export const regionsOf = (country: Country): string[] => REGION_CODES[country].map((r) => `${country}-${r}`);

/** Ist das ein bekannter Regionscode? (`""` gilt hier nicht – „keine Feiertage“ prüft der Aufrufer.) */
export function isHolidayRegion(code: string): boolean {
  const m = /^(DE|AT|CH)-([A-Z0-9]{1,2})$/.exec(code);
  return !!m && REGION_CODES[m[1] as Country].includes(m[2]);
}

const parseRegion = (code: string): { country: Country; region: string } | null => {
  if (!isHolidayRegion(code)) return null;
  const [country, region] = code.split("-");
  return { country: country as Country, region };
};

/** Kennung einer Regel, wie sie in der Datenbank steht: `<Land>.<Schlüssel>` (`DE.corpusChristi`). */
export const ruleId = (country: Country, key: string): string => `${country}.${key}`;

function dateOfRule(rule: Rule, year: number, easter: string): string {
  const w = rule.when;
  if ("fixed" in w) return ymd(year, w.fixed[0], w.fixed[1]);
  if ("easter" in w) return addDaysToKey(easter, w.easter);
  return w.rule(year, easter);
}

/* ───────────── Konfiguration und Ergebnis ───────────── */

/** Änderung an einem gesetzlichen Tag der Region: gestrichen, halber Tag oder (nur bei Vorschlägen) eingeschaltet. */
export type RuleMode = "off" | "half" | "on";
export const RULE_MODES: readonly RuleMode[] = ["off", "half", "on"];

export type CustomHoliday = { id: string; name: string; month: number; day: number; /** null = jedes Jahr */ year: number | null; half: boolean };

export type HolidayConfig = {
  /** Regionscode oder `""` */
  region: string;
  /** Änderungen je Regel-Kennung (`DE.corpusChristi`) */
  rules: Readonly<Record<string, RuleMode>>;
  custom: readonly CustomHoliday[];
};

export const NO_HOLIDAYS: HolidayConfig = { region: "", rules: {}, custom: [] };

export type Holiday = {
  /** Kalendertag `JJJJ-MM-TT` */
  day: string;
  /** Regel-Kennung ohne Land (`corpusChristi`, Beschriftung `holidays.names.<key>`) oder `custom:<id>` */
  key: string;
  /** Name eigener Tage */
  name: string | null;
  /** halber Tag */
  half: boolean;
  custom: boolean;
  /** gilt nur in Teilen der Region */
  partial: boolean;
};

export type StatutoryDay = { id: string; key: string; day: string; optional: boolean; partial: boolean; /** wirksam nach den Änderungen */ mode: RuleMode | null };

/** Die Regeln der Region für ein Jahr samt Datum – ohne Änderungen der Werkstatt (für die Pflegeliste); `mode` ist die Änderung, falls es eine gibt. */
export function statutoryDays(year: number, region: string, rules: Readonly<Record<string, RuleMode>> = {}): StatutoryDay[] {
  const parsed = parseRegion(region);
  if (!parsed) return [];
  const easter = easterKey(year);
  return RULES[parsed.country]
    .filter((r) => r.regions === "all" || r.regions.includes(parsed.region))
    .map((r) => {
      const id = ruleId(parsed.country, r.key);
      return { id, key: r.key, day: dateOfRule(r, year, easter), optional: !!r.optional, partial: !!r.partialIn?.includes(parsed.region), mode: rules[id] ?? null };
    })
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.key < b.key ? -1 : 1));
}

/** Die Feiertage eines Jahres nach den Einstellungen, nach Tag sortiert; ein Tag gibt es höchstens einmal (ein ganzer schlägt einen halben). */
export function holidaysInYear(year: number, config: HolidayConfig): Holiday[] {
  const byDay = new Map<string, Holiday>();
  const add = (h: Holiday) => {
    const old = byDay.get(h.day);
    if (!old || (old.half && !h.half)) byDay.set(h.day, h);
  };
  for (const s of statutoryDays(year, config.region, config.rules)) {
    if (s.optional ? s.mode !== "on" && s.mode !== "half" : s.mode === "off") continue;
    add({ day: s.day, key: s.key, name: null, half: s.mode === "half", custom: false, partial: s.partial });
  }
  for (const c of config.custom) {
    if (c.year !== null && c.year !== year) continue;
    const day = ymd(year, c.month, c.day);
    if (!isCalendarDay(day)) continue; // 29. Februar in einem Jahr ohne Schalttag
    add({ day, key: `custom:${c.id}`, name: c.name, half: c.half, custom: true, partial: false });
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** Nachschlagen von Feiertagen; merkt sich die Jahre. */
export type HolidayCalendar = {
  /** Der Feiertag an diesem Kalendertag (`JJJJ-MM-TT`) oder null */
  on(day: string): Holiday | null;
  /** Die Feiertage von `from` bis `to` (beide einschließlich) */
  between(from: string, to: string): Holiday[];
  readonly config: HolidayConfig;
};

/** Was die Berechnungen von Feiertagen brauchen: nur das Nachschlagen eines Tages (Arbeitstage, Hinweise); ohne Angabe sind Feiertage Arbeitstage. */
export type HolidayLookup = Pick<HolidayCalendar, "on">;

export function createHolidayCalendar(config: HolidayConfig): HolidayCalendar {
  const years = new Map<number, Map<string, Holiday>>();
  const year = (y: number) => {
    let map = years.get(y);
    if (!map) {
      map = new Map(holidaysInYear(y, config).map((h) => [h.day, h]));
      years.set(y, map);
    }
    return map;
  };
  return {
    config,
    on: (day) => (isCalendarDay(day) ? (year(Number(day.slice(0, 4))).get(day) ?? null) : null),
    between(from, to) {
      if (!isCalendarDay(from) || !isCalendarDay(to) || to < from) return [];
      const out: Holiday[] = [];
      for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) for (const h of year(y).values()) if (h.day >= from && h.day <= to) out.push(h);
      return out.sort((a, b) => (a.day < b.day ? -1 : 1));
    },
  };
}

/** Der Feiertag, auf den der Zeitpunkt in der Zone der Werkstatt fällt. */
export function holidayOnDate(calendar: HolidayCalendar, date: Date | number, timeZone: string = workshopZone()): Holiday | null {
  return calendar.on(dayKey(date, timeZone));
}
