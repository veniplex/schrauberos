import { TIRE_CONDITIONS, TIRE_POSITIONS, type TireCondition, type TirePosition } from "./constants";

export type TireRules = {
  treadWarnMm: number;
  treadReplaceMm: number;
  tireAgeWarnYears: number;
  tireAgeReplaceYears: number;
};

export const DEFAULT_TIRE_RULES: TireRules = {
  treadWarnMm: 4,
  treadReplaceMm: 3,
  tireAgeWarnYears: 6,
  tireAgeReplaceYears: 10,
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

/** Welche Saison sollte jetzt montiert sein? Okt–Mär Winter, sonst Sommer. */
export function wantedSeason(now = new Date()): "summer" | "winter" {
  const m = now.getMonth(); // 0 = Jan
  return m >= 9 || m <= 2 ? "winter" : "summer";
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
export function parseTireRows(rows: Partial<Record<TirePosition, RawTireRow>>, withSpare: boolean, now = new Date()): { tires: TireRowData[]; errors: Record<string, "dot" | "tread"> } {
  const errors: Record<string, "dot" | "tread"> = {};
  const positions: readonly TirePosition[] = withSpare ? TIRE_POSITIONS : TIRE_POSITIONS.filter((p) => p !== "SPARE");
  const tires = positions.map((position) => {
    const row = rows[position] ?? {};
    const dotRaw = row.dot?.trim() || undefined;
    const treadRaw = row.tread?.trim().replace(",", ".") || undefined;
    const conditionRaw = row.condition ?? "good";

    const dot = dotRaw ? parseDot(dotRaw) : null;
    if (dotRaw && (!dot || dot.year > now.getFullYear())) errors[`tire.${position}.dot`] = "dot";
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
