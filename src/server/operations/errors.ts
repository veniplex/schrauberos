import { fieldMessages, type FieldMessage } from "@/lib/field-errors";
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
  /** Datenbank vorübergehend nicht erreichbar/überlastet (Transaktion kam nicht zustande): später wiederholen */
  | "busy"
  /** unerwarteter Fehler */
  | "failed";

export type { FieldMessage };

export type OperationFailure = {
  code: ErrorCode;
  key?: MessageKey;
  params?: Vars;
  /** Feldname → Meldung */
  fields?: Record<string, FieldMessage>;
  /** Zusatzangaben für das Formular (nur Text, z. B. Kennung und Kennzeichen eines vorhandenen Fahrzeugs bei einer Kennzeichen-Warnung); Server Actions geben sie als `state.data` weiter, die API nicht */
  data?: Record<string, string>;
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
  busy: "common.errors.busy",
  failed: "common.errors.failed",
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

/** Mehrere Feldfehler auf einmal; `data`: Zusatzangaben für das Formular (siehe `OperationFailure.data`). */
export function failFields(fields: Record<string, FieldMessage>, data?: Record<string, string>): never {
  throw new OperationError({ code: "invalid", fields, ...(data ? { data } : {}) });
}

/**
 * Zod-Fehler → Feldname → Meldungsschlüssel (Code→Schlüssel-Abbildung, siehe `src/lib/field-errors.ts`: spezifische Texte für E-Mail, Zahlenbereiche, Länge, eigene
 * Schlüssel wie `validation.vin`; Texte und Darstellung liefern der Adapter und `Field`/`FormErrorSummary`). Leere Formularfelder fehlen vorab im Objekt → „fehlt“ = Pflichtfeld.
 * Eigene Prüfungen tragen den Meldungsschlüssel als `message` und Platzhalter in `params`: `ctx.addIssue({ code: "custom", message: "account.errors.passwordShort", params: { min: 8 } })`.
 */
export const fieldErrors = fieldMessages;

/**
 * Fehler der Datenbank, die einen Zustand der Daten (nicht einen Programmfehler) melden: P2002 (doppelt), P2025 (fehlt), P2003 (Fremdschlüssel), P2028 (Transaktion
 * kam nicht zustande: Wartezeit/Zeitlimit – vorübergehend, später wiederholen).
 *
 * P2003 heißt je nach Vorgang etwas anderes: Beim **Löschen** hängt noch etwas daran (`inUse`); beim **Anlegen/Ändern** ist ein Verweis ungültig geworden (der Verweisziel wurde
 * zwischenzeitlich gelöscht) – das ist ein Eingabefehler (`invalid`), nicht „wird noch verwendet“. `operation` ist der Name der Operation (`customers.delete` …).
 */
export function mapPrismaError(error: unknown, operation?: string): OperationFailure | null {
  const code = error instanceof Error ? (error as { code?: unknown }).code : undefined;
  if (typeof code !== "string") return null;
  if (code === "P2002") return { code: "duplicate" };
  if (code === "P2025") return { code: "notFound" };
  if (code === "P2003") return operation === undefined || /(?:^|[._-])(?:delete|remove)/i.test(operation) ? { code: "inUse" } : { code: "invalid" };
  if (code === "P2028") return { code: "busy" };
  return null;
}
