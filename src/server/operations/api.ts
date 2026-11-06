import "server-only";
import { problemOf, type Problem, type ProblemFields } from "@/lib/api/problem";
import { DEFAULT_KEYS, type OperationFailure } from "./errors";
import type { Operation, Principal } from "./operation";

/**
 * Adapter „HTTP-API“ des Aktions-Rahmens. Er übersetzt nur zwischen Operation und HTTP-Semantik – die Pipeline (Authentifizierung, Rate-Limit,
 * Idempotenz, Routing) liegt in `src/server/api`, die Ressourcen bringen die Funktionen in ihrer `api.ts` mit.
 *
 * Unterschiede zur Server Action: JSON statt FormData, Bearer-Token statt Sitzungs-Cookie (das Cookie wird hier **nie** gelesen, ebenso wenig
 * akzeptieren UI-Aktionen ein Token), Statuscodes und Problem-Antworten statt Flash/Weiterleitung. Der Kern (`defineOperation`) ist derselbe: Recht,
 * Eingabe der Sache, Transaktion, Hooks, Audit.
 */

/** Ergebnis der Authentifizierung einer API-Anfrage. */
export type ApiAuthResult =
  | { ok: true; principal: Principal; token: { id: string; rateLimitPerMinute: number } }
  /** abgelehnt: fertige Antwort (401, oder 429 im Fehlerpfad ungültiger Tokens) */
  | { ok: false; response: Response };

/** Prüft die Anmeldung einer API-Anfrage (Bearer-Token). Wird in `src/server/api/auth.ts` gesetzt; Standard: lehnt alles mit 401 ab. */
export type ApiAuthenticator = (request: Request) => Promise<ApiAuthResult>;

const unauthenticated = async (): Promise<ApiAuthResult> => ({ ok: false, response: problemResponse(problemOf("unauthenticated"), { "www-authenticate": 'Bearer realm="schrauberos"' }) });
// im globalen Objekt, damit jede Instanz des Moduls (Route, Tests) denselben Authentifizierer sieht
const globalForApi = globalThis as unknown as { __apiAuthenticator?: ApiAuthenticator };

export function setApiAuthenticator(next: ApiAuthenticator): void {
  globalForApi.__apiAuthenticator = next;
}
export const getApiAuthenticator = (): ApiAuthenticator => globalForApi.__apiAuthenticator ?? unauthenticated;

/** Problem-Antwort (`application/problem+json`, nie zwischenspeichern). */
export function problemResponse(problem: Problem, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(problem), {
    status: problem.status,
    headers: { "content-type": "application/problem+json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers },
  });
}

/** Fachlicher oder Protokoll-Fehler in einem Endpunkt: wird in der Pipeline zur Problem-Antwort. */
export class ApiProblemError extends Error {
  constructor(
    readonly problem: Problem,
    readonly headers: Record<string, string> = {},
  ) {
    super(`api:${problem.code}`);
    this.name = "ApiProblemError";
  }
}

export const apiProblem = (code: Parameters<typeof problemOf>[0], extra?: Parameters<typeof problemOf>[1], headers?: Record<string, string>): ApiProblemError => new ApiProblemError(problemOf(code, extra), headers);

/** Umbenennung von Feldnamen der Operation in die der API (wo beide abweichen): Tabelle oder Funktion. */
export type Rename = Readonly<Record<string, string>> | ((name: string) => string);
const renamed = (rename: Rename, name: string): string => (typeof rename === "function" ? rename(name) : (rename[name] ?? name));

/** Fehler einer Operation → Problem. `rename`: Feldname der Operation → Feldname der API (wo beide abweichen). */
export function failureToProblem(failure: OperationFailure, rename: Rename = {}): Problem {
  const fields: ProblemFields | undefined = failure.fields
    ? Object.fromEntries(Object.entries(failure.fields).map(([name, f]) => [renamed(rename, name), { code: f.key, ...(f.params ? { params: f.params as Record<string, string | number> } : {}) }]))
    : undefined;
  const reason = failure.key ?? (failure.fields ? undefined : DEFAULT_KEYS[failure.code]);
  const extra = { ...(fields ? { fields } : {}), ...(reason && failure.code !== "invalid" ? { reason } : {}), ...(failure.params && !fields ? { params: failure.params as Record<string, string | number> } : {}) };
  switch (failure.code) {
    case "invalid":
      return problemOf("validation_failed", fields ? { fields } : { reason });
    case "unauthenticated":
      return problemOf("unauthenticated");
    case "forbidden":
      return problemOf("forbidden", extra);
    case "notFound":
      return problemOf("not_found");
    // „conflict“ meldet nur die Versionsprüfung (claimRow): der Datensatz wurde zwischenzeitlich geändert
    case "conflict":
      return problemOf("precondition_failed");
    case "duplicate":
      return problemOf("conflict", extra);
    case "inUse":
      return problemOf("in_use", extra);
    case "busy":
      return problemOf("service_unavailable");
    case "failed":
      return problemOf("internal_error");
  }
}

/** Führt eine Operation für den API-Principal aus: Daten bei Erfolg, sonst `ApiProblemError`. */
export async function runApiOperation<I, R>(operation: Operation<I, R>, principal: Principal, raw: unknown, rename: Rename = {}): Promise<R> {
  const outcome = await operation.execute(principal, raw);
  if (!outcome.ok) throw new ApiProblemError(failureToProblem(outcome.failure, rename), outcome.failure.code === "busy" ? { "retry-after": "2" } : undefined);
  return outcome.data;
}
