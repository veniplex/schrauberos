import { wallOf, workshopZone } from "@/lib/zone";
import { TIRE_CONDITIONS, TIRE_POSITIONS, type TireCondition, type TirePosition, type TireSetStatus } from "./constants";

/** Winterfenster in Kalendermonaten (1–12), beide einschließlich. Liegt der Beginn nach dem Ende, geht das Fenster über den Jahreswechsel (Standard: Oktober bis März). */
export type SeasonWindow = { winterStartMonth: number; winterEndMonth: number };

export type TireRules = SeasonWindow & {
  treadWarnMm: number;
  treadReplaceMm: number;
  tireAgeWarnYears: number;
  tireAgeReplaceYears: number;
};

export const DEFAULT_SEASON_WINDOW: SeasonWindow = { winterStartMonth: 10, winterEndMonth: 3 };

export const DEFAULT_TIRE_RULES: TireRules = {
  treadWarnMm: 4,
  treadReplaceMm: 3,
  tireAgeWarnYears: 6,
  tireAgeReplaceYears: 10,
  ...DEFAULT_SEASON_WINDOW,
};

/** "2321" -> Woche 23 / Jahr 2021. Liefert null bei ungültigem DOT-Kürzel. */
export function parseDot(input: string | null | undefined): { week: number; year: number } | null {
  const m = /^\s*(\d{2})(\d{2})\s*$/.exec(input ?? "");
  if (!m) return null;
  const week = Number(m[1]);
  const yy = Number(m[2]);
  if (week < 1 || week > 53) return null;
  // Vierstellige DOT-Kürzel gibt es seit 2000 (davor dreistellig) – alle relevanten Reifen sind also 20xx.
  const year = 2000 + yy;
  return { week, year };
}

/** Ungefähres Produktionsdatum (Montag der DOT-Woche). */
export function producedDate(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setUTCDate(jan4.getUTCDate() - (dayOfWeek - 1));
  const d = new Date(mondayWeek1);
  d.setUTCDate(mondayWeek1.getUTCDate() + (week - 1) * 7);
  return d;
}

export function tireAgeYears(
  tire: { producedYear: number | null; producedWeek: number | null },
  now = new Date(),
): number | null {
  if (!tire.producedYear || !tire.producedWeek) return null;
  const ms = now.getTime() - producedDate(tire.producedYear, tire.producedWeek).getTime();
  return Math.max(0, ms / (365.25 * 24 * 3600 * 1000));
}

export type Health = "ok" | "warn" | "replace" | "unknown";

const HEALTH_RANK: Record<Health, number> = { unknown: 0, ok: 1, warn: 2, replace: 3 };

export function worseHealth(a: Health, b: Health): Health {
  return HEALTH_RANK[a] >= HEALTH_RANK[b] ? a : b;
}

export type TireHealth = {
  health: Health;
  reasons: Array<"tread" | "age" | "condition">;
  ageYears: number | null;
};

export function tireHealth(
  tire: {
    producedYear: number | null;
    producedWeek: number | null;
    treadDepthMm: number | null;
    condition: string;
  },
  rules: TireRules,
  now = new Date(),
): TireHealth {
  const reasons: TireHealth["reasons"] = [];
  let health: Health = "ok";
  const age = tireAgeYears(tire, now);

  if (tire.treadDepthMm != null) {
    if (tire.treadDepthMm < rules.treadReplaceMm) {
      health = worseHealth(health, "replace");
      reasons.push("tread");
    } else if (tire.treadDepthMm < rules.treadWarnMm) {
      health = worseHealth(health, "warn");
      reasons.push("tread");
    }
  }
  if (age != null) {
    if (age >= rules.tireAgeReplaceYears) {
      health = worseHealth(health, "replace");
      reasons.push("age");
    } else if (age >= rules.tireAgeWarnYears) {
      health = worseHealth(health, "warn");
      reasons.push("age");
    }
  }
  const cond = tire.condition as TireCondition;
  if (cond === "damaged" || cond === "worn") {
    health = worseHealth(health, "replace");
    reasons.push("condition");
  } else if (cond === "fair") {
    health = worseHealth(health, "warn");
    reasons.push("condition");
  }
  if (tire.treadDepthMm == null && age == null && reasons.length === 0) health = "unknown";
  return { health, reasons, ageYears: age };
}

export function setHealth(
  tires: Parameters<typeof tireHealth>[0][],
  rules: TireRules,
  now = new Date(),
): TireHealth {
  let health: Health = "unknown";
  const reasons = new Set<TireHealth["reasons"][number]>();
  let maxAge: number | null = null;
  for (const t of tires) {
    const h = tireHealth(t, rules, now);
    health = worseHealth(health, h.health);
    h.reasons.forEach((r) => reasons.add(r));
    if (h.ageYears != null && (maxAge == null || h.ageYears > maxAge)) maxAge = h.ageYears;
  }
  return { health, reasons: [...reasons], ageYears: maxAge };
}

export function minTread(tires: { treadDepthMm: number | null }[]): number | null {
  const values = tires.map((t) => t.treadDepthMm).filter((v): v is number => v != null);
  return values.length ? Math.min(...values) : null;
}

/** Welche Saison sollte jetzt montiert sein? Im Winterfenster (Standard Okt–Mär) Winter, sonst Sommer – der Monat zählt in der Zeitzone der Werkstatt. */
export function wantedSeason(now = new Date(), window: SeasonWindow = DEFAULT_SEASON_WINDOW, timeZone: string = workshopZone()): "summer" | "winter" {
  const month = wallOf(now, timeZone).month; // 1 = Jan
  const { winterStartMonth: from, winterEndMonth: to } = window;
  const winter = from <= to ? month >= from && month <= to : month >= from || month <= to;
  return winter ? "winter" : "summer";
}

/**
 * Ist ein Fenster zulässig? Beginn und Ende sind Monate 1–12; das Fenster darf nicht das ganze Jahr umfassen (Beginn = Ende + 1), sonst gäbe es nie Sommer.
 * Beginn = Ende ist ein einzelner Monat.
 */
export function isValidSeasonWindow({ winterStartMonth: from, winterEndMonth: to }: SeasonWindow): boolean {
  const month = (m: number) => Number.isInteger(m) && m >= 1 && m <= 12;
  return month(from) && month(to) && from !== (to % 12) + 1;
}

/**
 * Montiert, aber zur Jahreszeit passt der andere Satz? Nur Sommer-/Winter-Sätze beim Kunden (`mounted`) zählen – Ganzjahressätze passen immer, gelagerte
 * und entsorgte Sätze sind kein Thema.
 */
export function isWrongSeason(set: { status: string; season: string }, wanted: "summer" | "winter"): boolean {
  return set.status === "mounted" && (set.season === "summer" || set.season === "winter") && set.season !== wanted;
}

/** So lange nach dem Erledigen eines Wechseltermins mahnt der Satz noch, dass er nicht gebucht wurde. */
export const PENDING_STOCK_DAYS = 30;

/**
 * Ist ein Wechseltermin erledigt, ohne dass der verknüpfte Satz danach gebucht wurde? Der jüngste erledigte Termin der letzten `PENDING_STOCK_DAYS` Tage zählt; „nicht gebucht“
 * heißt: Der Satz wurde seit dem Erledigen nicht mehr angefasst (`updatedAt` des Satzes vor dem des Termins) und ist buchbar (nicht entsorgt). Eine Näherung – jede spätere
 * Änderung am Satz nimmt den Hinweis zurück.
 */
export function pendingStockBooking<A extends { status: string; startsAt: Date; updatedAt: Date }>(
  set: { status: string; updatedAt: Date },
  appointments: readonly A[],
  now = new Date(),
): A | null {
  if (suggestedStockStatus(set.status) === null) return null;
  const since = now.getTime() - PENDING_STOCK_DAYS * 86_400_000;
  const done = appointments.filter((a) => a.status === "done" && a.updatedAt.getTime() >= since).sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0];
  return done && set.updatedAt.getTime() < done.updatedAt.getTime() ? done : null;
}

/**
 * Was schlägt „Satz jetzt ein-/ausbuchen?“ nach einem erledigten Wechseltermin vor? Ein gelagerter Satz wird ausgebucht (`mounted`: geht ans Fahrzeug),
 * ein ausgelagerter wieder eingebucht (`stored`: kommt zurück ins Lager); ein entsorgter Satz lässt sich nicht buchen (null).
 */
export function suggestedStockStatus(status: string): Extract<TireSetStatus, "stored" | "mounted"> | null {
  return status === "stored" ? "mounted" : status === "mounted" ? "stored" : null;
}

export function formatTireSize(s: {
  width: number | null;
  aspect: number | null;
  rim: number | null;
  loadIndex?: string | null;
  speedIndex?: string | null;
}): string {
  if (!s.width || !s.aspect || !s.rim) return "–";
  return `${s.width}/${s.aspect} R${s.rim}${s.loadIndex || s.speedIndex ? ` ${s.loadIndex ?? ""}${s.speedIndex ?? ""}` : ""}`;
}

/* ───────────── Einzelreifen aus dem Formular ───────────── */


/** Rohwerte eines Reifens im Formular (Felder `tire.<POS>.dot|tread|condition`). */
export type RawTireRow = { dot?: string; tread?: string; condition?: string };

export type TireRowData = {
  position: TirePosition;
  dot: string | null;
  producedWeek: number | null;
  producedYear: number | null;
  treadDepthMm: number | null;
  condition: string;
  measuredAt: Date | null;
};

/**
 * Prüft und übersetzt die Reifenzeilen eines Satzes (reine Funktion). Ersatzrad (`SPARE`) zählt nur mit `withSpare`.
 * `errors` nennt je Feld (`tire.<POS>.dot` / `tire.<POS>.tread`) den Fehler: ungültiges oder zukünftiges DOT (vermutlich vertippt,
 * z. B. 1234 = Woche 12/2034), Profiltiefe außerhalb 0–15 mm (Komma als Dezimalzeichen erlaubt).
 */
export function parseTireRows(rows: Partial<Record<TirePosition, RawTireRow>>, withSpare: boolean, now = new Date(), timeZone: string = workshopZone()): { tires: TireRowData[]; errors: Record<string, "dot" | "tread"> } {
  const errors: Record<string, "dot" | "tread"> = {};
  const positions: readonly TirePosition[] = withSpare ? TIRE_POSITIONS : TIRE_POSITIONS.filter((p) => p !== "SPARE");
  const tires = positions.map((position) => {
    const row = rows[position] ?? {};
    const dotRaw = row.dot?.trim() || undefined;
    const treadRaw = row.tread?.trim().replace(",", ".") || undefined;
    const conditionRaw = row.condition ?? "good";

    const dot = dotRaw ? parseDot(dotRaw) : null;
    if (dotRaw && (!dot || dot.year > wallOf(now, timeZone).year)) errors[`tire.${position}.dot`] = "dot";
    const tread = treadRaw !== undefined ? Number(treadRaw) : null;
    if (tread !== null && (!Number.isFinite(tread) || tread < 0 || tread > 15)) errors[`tire.${position}.tread`] = "tread";
    const condition = (TIRE_CONDITIONS as readonly string[]).includes(conditionRaw) ? conditionRaw : "good";

    return {
      position,
      dot: dotRaw && dot ? dotRaw : null,
      producedWeek: dot?.week ?? null,
      producedYear: dot?.year ?? null,
      treadDepthMm: tread,
      condition,
      measuredAt: tread !== null ? now : null,
    };
  });
  return { tires, errors };
}
