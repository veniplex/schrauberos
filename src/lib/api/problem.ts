/**
 * Einheitliches Fehlerformat der API (angelehnt an RFC 9457 „Problem Details“): `Content-Type: application/problem+json`,
 *
 *   { type, title, status, code, detail, fields?, reason?, params? }
 *
 * `code` ist der maschinenlesbare Fehlercode (siehe `PROBLEMS`), `fields` nennt je Eingabefeld einen Meldungsschlüssel (`code`) mit
 * Platzhaltern. Texte sind englisch und allgemein – keine Interna (kein Stack, keine SQL-/Pfadangaben, keine Existenz-Hinweise).
 */
export const PROBLEMS = {
  unauthenticated: { status: 401, title: "Authentication required", detail: "A valid API token is required." },
  forbidden: { status: 403, title: "Forbidden", detail: "The token is not allowed to do this." },
  not_found: { status: 404, title: "Not found", detail: "The resource does not exist." },
  method_not_allowed: { status: 405, title: "Method not allowed", detail: "This method is not supported here." },
  bad_request: { status: 400, title: "Bad request", detail: "The request could not be understood." },
  conflict: { status: 409, title: "Conflict", detail: "The request conflicts with existing data." },
  in_use: { status: 409, title: "Resource in use", detail: "The resource is still referenced and cannot be removed." },
  precondition_failed: { status: 412, title: "Precondition failed", detail: "The resource was changed by someone else; reload it and try again." },
  precondition_required: { status: 428, title: "Precondition required", detail: "Send the current version in the If-Match header." },
  payload_too_large: { status: 413, title: "Payload too large", detail: "The request body is too large." },
  unsupported_media_type: { status: 415, title: "Unsupported media type", detail: "Send the body as application/json." },
  validation_failed: { status: 422, title: "Validation failed", detail: "The request contains invalid data." },
  idempotency_key_reuse: { status: 422, title: "Idempotency key reused", detail: "This Idempotency-Key was already used for a different request." },
  idempotency_in_progress: { status: 409, title: "Request in progress", detail: "A request with this Idempotency-Key is still being processed." },
  rate_limited: { status: 429, title: "Too many requests", detail: "Rate limit exceeded; retry later." },
  service_unavailable: { status: 503, title: "Service unavailable", detail: "The service is busy; retry shortly." },
  storage_full: { status: 507, title: "Insufficient storage", detail: "The server is almost out of disk space; uploads are paused until space is freed." },
  internal_error: { status: 500, title: "Internal error", detail: "The request could not be processed." },
} as const;

export type ProblemCode = keyof typeof PROBLEMS;

export type ProblemFields = Record<string, { code: string; params?: Record<string, string | number> }>;

export type Problem = {
  type: string;
  title: string;
  status: number;
  code: ProblemCode;
  detail: string;
  fields?: ProblemFields;
  /** Meldungsschlüssel eines fachlichen Fehlers ohne Feldbezug (z. B. „wird noch verwendet“) */
  reason?: string;
  params?: Record<string, string | number>;
};

export function problemOf(code: ProblemCode, extra: { fields?: ProblemFields; reason?: string; params?: Record<string, string | number> } = {}): Problem {
  const p = PROBLEMS[code];
  return { type: `urn:schrauberos:problem:${code}`, title: p.title, status: p.status, code, detail: p.detail, ...extra };
}
