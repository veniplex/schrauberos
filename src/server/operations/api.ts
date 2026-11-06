import "server-only";
import { logError } from "@/lib/log-safe";
import { DEFAULT_KEYS, STATUS, type OperationFailure } from "./errors";
import type { Operation, Principal } from "./operation";

/**
 * Adapter „HTTP-API“ des Aktions-Rahmens – nur Gerüst und Typen. Der API-Kern (Token-Tabelle, Bearer-Authentifizierung, Rate-Limit,
 * Idempotenz, Fehlerformat im Detail, OpenAPI) folgt in P1a-8; bis dahin lehnt der Standard-Authentifizierer jede Anfrage mit 401 ab.
 *
 * Unterschiede zur Server Action: JSON statt FormData, Bearer-Token statt Sitzungs-Cookie (das Cookie wird hier **nie** gelesen,
 * ebenso wenig akzeptieren UI-Aktionen ein Token), Statuscodes statt Flash/Weiterleitung. Der Kern ist derselbe.
 */

/** Liefert die Person/Token-Besitzer samt Rechten zu einer Anfrage, oder null (→ 401). Wird in P1a-8 durch die Token-Prüfung ersetzt. */
export type ApiAuthenticator = (request: Request) => Promise<Principal | null>;

let authenticator: ApiAuthenticator = async () => null;

export function setApiAuthenticator(next: ApiAuthenticator): void {
  authenticator = next;
}

export type ApiContext = { params: Promise<Record<string, string>> };

export type ApiOptions<I, R> = {
  /** Erfolgsstatus (Standard 200; 201 beim Anlegen) */
  status?: number;
  /** Anfrage → rohe Eingabe der Operation (Standard: JSON-Body, Pfadparameter ergänzt). */
  input?: (request: Request, params: Record<string, string>) => unknown | Promise<unknown>;
  /** Ergebnis → Antwortkörper (Standard: `{ data }`) */
  serialize?: (data: R, input: I) => unknown;
};

export type ApiHandler = (request: Request, context: ApiContext) => Promise<Response>;

/** Fehlerformat der API: sprachneutral (Code, Meldungsschlüssel, Feldfehler); die Doku nennt die Schlüssel. */
export function errorBody(failure: OperationFailure): { error: { code: string; message: string; params?: unknown; fields?: Record<string, { message: string; params?: unknown }> } } {
  return {
    error: {
      code: failure.code,
      message: failure.key ?? DEFAULT_KEYS[failure.code],
      params: failure.params,
      fields: failure.fields ? Object.fromEntries(Object.entries(failure.fields).map(([name, f]) => [name, { message: f.key, params: f.params }])) : undefined,
    },
  };
}

const json = (status: number, body: unknown) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export function defineApi<I, R>(operation: Operation<I, R>, options: ApiOptions<I, R> = {}): ApiHandler & { operation: Operation<I, R> } {
  const handler: ApiHandler = async (request, context) => {
    const principal = await authenticator(request);
    if (!principal) return json(STATUS.unauthenticated, errorBody({ code: "unauthenticated" }));

    const params = await context.params.catch(() => ({}) as Record<string, string>);
    let raw: unknown;
    try {
      raw = options.input ? await options.input(request, params) : { ...(request.method === "GET" || request.method === "DELETE" ? {} : ((await request.json()) as object)), ...params };
    } catch {
      return json(400, errorBody({ code: "invalid", key: "common.errors.badRequest" }));
    }

    try {
      const outcome = await operation.execute(principal, raw);
      if (!outcome.ok) return json(STATUS[outcome.failure.code], errorBody(outcome.failure));
      return json(options.status ?? 200, options.serialize ? options.serialize(outcome.data, outcome.input) : { data: outcome.data });
    } catch (error) {
      logError(`api:${operation.name}`, error);
      return json(STATUS.failed, errorBody({ code: "failed" }));
    }
  };
  return Object.assign(handler, { operation });
}
