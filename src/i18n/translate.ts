import type { Messages } from "./messages/de";
import { INTL_LOCALE, type Locale } from "./config";

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type MessageKey = Leaves<Messages>;
/** Basis-Schlüssel mit Plural-Varianten `<key>_one` / `<key>_other`. */
export type PluralKey = MessageKey extends infer K
  ? K extends `${infer B}_one`
    ? B
    : never
  : never;

export type Vars = Record<string, string | number>;

export type Translator = {
  locale: Locale;
  t: (key: MessageKey, vars?: Vars) => string;
  /** Plural: wählt `<key>_one` bei n === 1, sonst `<key>_other`; `{count}` wird ersetzt. */
  tp: (key: PluralKey, count: number, vars?: Vars) => string;
  /** Prüft zur Laufzeit, ob ein dynamisch gebildeter Schlüssel existiert (z. B. enums.*). */
  has: (key: string) => boolean;
  /** Dynamische Schlüssel (Enum-Werte aus der DB) – fällt auf den Rohwert zurück. */
  td: (key: string, fallback?: string) => string;
  date: (d: Date | string | number, opts?: Intl.DateTimeFormatOptions) => string;
  number: (n: number, opts?: Intl.NumberFormatOptions) => string;
};

function lookup(messages: Messages, key: string): string | undefined {
  let cur: unknown = messages;
  for (const part of key.split(".")) {
    if (cur && typeof cur === "object" && part in cur) cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return typeof cur === "string" ? cur : undefined;
}

/**
 * Platzhalter `{name}`; `{name|time}` formatiert einen Zeitpunkt (ISO-Text, Date-Zahl) als Uhrzeit der Sprache (de „14:30“, en „2:30 PM“) in der Zeitzone des Prozesses.
 * So bleiben Operationen sprachneutral: Sie geben den Zeitpunkt weiter, nicht schon einen formatierten Text.
 */
function interpolate(template: string, vars: Vars | undefined, intl: string): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)(?:\|(time))?\}/g, (match, name: string, format?: string) => {
    if (!(name in vars)) return `{${name}}`;
    if (format === "time") {
      const at = new Date(vars[name]);
      return Number.isNaN(at.getTime()) ? String(vars[name]) : new Intl.DateTimeFormat(intl, { timeStyle: "short" }).format(at);
    }
    return String(vars[name]);
  });
}

export function createTranslator(locale: Locale, messages: Messages): Translator {
  const intl = INTL_LOCALE[locale];
  const t = (key: string, vars?: Vars) => interpolate(lookup(messages, key) ?? key, vars, intl);
  return {
    locale,
    t: t as Translator["t"],
    tp: ((key: string, count: number, vars?: Vars) => {
      const form = count === 1 ? "one" : "other";
      return t(`${key}_${form}`, { count, ...vars });
    }) as Translator["tp"],
    has: (key) => lookup(messages, key) !== undefined,
    td: (key, fallback) => lookup(messages, key) ?? fallback ?? key,
    date: (d, opts = { dateStyle: "medium" }) => new Intl.DateTimeFormat(intl, opts).format(new Date(d)),
    number: (n, opts) => new Intl.NumberFormat(intl, opts).format(n),
  };
}
