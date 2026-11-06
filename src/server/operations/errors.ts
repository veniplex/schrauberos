import type { ZodError } from "zod";
import type { MessageKey, Vars } from "@/i18n/translate";

/**
 * Fehler der Operationen (transportneutral): Codes und Meldungsschlüssel, keine übersetzten Texte. Der Adapter übersetzt
 * (Server Action: Sprache der Sitzung) bzw. wählt den Statuscode (API).
 */
export type ErrorCode =
  /** Eingabe ungültig (Feldfehler) */
  | "invalid"
  /** nicht angemeldet / kein gültiges Token */
  | "unauthenticated"
  /** Recht fehlt */
  | "forbidden"
  | "notFound"
  /** inzwischen von jemand anderem geändert */
  | "conflict"
  /** Eindeutigkeit verletzt */
  | "duplicate"
  /** wird noch verwendet (Fremdschlüssel) */
  | "inUse"
  /** unerwarteter Fehler */
  | "failed";

export type FieldMessage = { key: MessageKey; params?: Vars };

export type OperationFailure = {
  code: ErrorCode;
  key?: MessageKey;
  params?: Vars;
  /** Feldname → Meldung */
  fields?: Record<string, FieldMessage>;
};

/** Standardmeldung je Fehlercode (wenn der Fehler keinen eigenen Schlüssel mitbringt). */
export const DEFAULT_KEYS: Record<ErrorCode, MessageKey> = {
  invalid: "validation.invalid",
  unauthenticated: "common.errors.unauthenticated",
  forbidden: "common.errors.forbidden",
  notFound: "common.errors.notFound",
  conflict: "common.conflict",
  duplicate: "common.errors.duplicate",
  inUse: "common.errors.inUse",
  failed: "common.errors.failed",
};

/** HTTP-Statuscode je Fehlercode (API-Adapter). */
export const STATUS: Record<ErrorCode, number> = {
  invalid: 422,
  unauthenticated: 401,
  forbidden: 403,
  notFound: 404,
  conflict: 409,
  duplicate: 409,
  inUse: 409,
  failed: 500,
};

/**
 * Fachlicher Fehler innerhalb von `run`. Wird er geworfen, rollt die Transaktion zurück und der Adapter meldet ihn als Ergebnis
 * (Aktion: Fehlermeldung bzw. Flash, API: Statuscode). `run` kennt weder `redirect` noch Flash.
 */
export class OperationError extends Error {
  readonly failure: OperationFailure;
  constructor(failure: OperationFailure) {
    super(`${failure.code}${failure.key ? `: ${failure.key}` : ""}`);
    this.name = "OperationError";
    this.failure = failure;
  }
}

/** Wirft einen fachlichen Fehler mit Meldungsschlüssel. */
export function fail(code: ErrorCode, key?: MessageKey, params?: Vars): never {
  throw new OperationError({ code, key, params });
}

/** Wirft einen Feldfehler (Code `invalid`). */
export function failField(field: string, key: MessageKey, params?: Vars): never {
  throw new OperationError({ code: "invalid", fields: { [field]: { key, params } } });
}

/** Mehrere Feldfehler auf einmal. */
export function failFields(fields: Record<string, FieldMessage>): never {
  throw new OperationError({ code: "invalid", fields });
}

/**
 * Zod-Fehler → Feldname → Meldungsschlüssel (Code→Schlüssel-Abbildung; Texte und Darstellung liefert der Adapter bzw. später das Formular-Paket).
 * Leere Formularfelder fehlen vorab im Objekt → „fehlt“ = Pflichtfeld. Eigene Prüfungen (`custom`) tragen den Meldungsschlüssel
 * als `message` und Platzhalter in `params`: `ctx.addIssue({ code: "custom", message: "account.errors.passwordShort", params: { min: 8 } })`.
 */
const KEY_SHAPE = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/;

export function fieldErrors(error: ZodError): Record<string, FieldMessage> {
  const out: Record<string, FieldMessage> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "_");
    if (out[field]) continue;
    if (issue.code === "custom") {
      // Eigene Prüfungen tragen den Meldungsschlüssel in `message`; ein `refine` ohne eigenen Schlüssel (Zod-Standardtext) wird „ungültig“
      out[field] = KEY_SHAPE.test(issue.message) ? { key: issue.message as MessageKey, params: (issue as { params?: Vars }).params } : { key: "validation.invalid" };
      continue;
    }
    out[field] = { key: issue.code === "invalid_type" ? "validation.required" : issue.code === "too_big" ? "validation.tooLong" : "validation.invalid" };
  }
  return out;
}

/** Fehler der Datenbank, die einen Zustand der Daten (nicht einen Programmfehler) melden: P2002 (doppelt), P2025 (fehlt), P2003 (noch verwendet). */
export function mapPrismaError(error: unknown): OperationFailure | null {
  const code = error instanceof Error ? (error as { code?: unknown }).code : undefined;
  if (typeof code !== "string") return null;
  if (code === "P2002") return { code: "duplicate" };
  if (code === "P2025") return { code: "notFound" };
  if (code === "P2003") return { code: "inUse" };
  return null;
}
