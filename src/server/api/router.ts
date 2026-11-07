import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { problemOf, type ProblemFields } from "@/lib/api/problem";
import { logError } from "@/lib/log-safe";
import { apiEndpoints } from "@/modules/api";
import { apiProblem, ApiProblemError, getApiAuthenticator, problemResponse, type Principal } from "@/server/operations";
import "./auth";
import { hashBody, IDEMPOTENCY_KEY_SHAPE, completeIdempotency, releaseIdempotency, reserveIdempotency } from "./idempotency";
import { buildOpenApi } from "./openapi";
import { ID_SHAPE } from "./resource";
import { apiLimiters } from "./state";
import type { ApiCall, ApiEndpoint, ApiResult } from "./types";

/**
 * Die Pipeline von `/api/v1/*` (ein Eintrittspunkt: `src/app/api/v1/[...path]/route.ts`). Reihenfolge ist Absicht:
 *
 *  1. Token prüfen (alles ohne gültiges Token ist 401 – auch unbekannte Pfade, damit nichts über die Routen verraten wird),
 *  2. Rate-Limit je Token (429 mit `Retry-After`, Header `RateLimit-*` an jeder Antwort),
 *  3. Route finden (404), Funktion aktiv? (sonst 404 – ausgeschaltet heißt „gibt es nicht“), Methode (405), Recht (403: Scope ∩ Rechte des Besitzers),
 *  4. Filter und Körper prüfen (Größenlimit 1 MiB, `application/json`, strenge Schemas), `If-Match`,
 *  5. Idempotenz (`Idempotency-Key`): Wiederholung liefert die gespeicherte Antwort,
 *  6. Endpunkt ausführen; Fehler werden zu `application/problem+json` (nie Stack oder Interna).
 */
export const MAX_BODY_BYTES = 1_048_576;
const METHODS: readonly string[] = ["GET", "POST", "PATCH", "DELETE"];
const OPEN_API_PATH = "/openapi.json";

type Compiled = { endpoint: ApiEndpoint; parts: Array<{ literal: string } | { param: string }>; params: number };

const compileCache = new WeakMap<readonly ApiEndpoint[], Compiled[]>();

function compile(endpoints: readonly ApiEndpoint[]): Compiled[] {
  const cached = compileCache.get(endpoints);
  if (cached) return cached;
  const list = endpoints.map((endpoint) => {
    const parts = endpoint.path
      .split("/")
      .slice(1)
      .map((part) => (/^\{(\w+)\}$/.test(part) ? { param: part.slice(1, -1) } : { literal: part }));
    return { endpoint, parts, params: parts.filter((p) => "param" in p).length };
  });
  compileCache.set(endpoints, list);
  return list;
}

function matchPath(compiled: Compiled, segments: string[]): Record<string, string> | null {
  if (compiled.parts.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < segments.length; i++) {
    const part = compiled.parts[i];
    if ("literal" in part) {
      if (part.literal !== segments[i]) return null;
    } else {
      if (!ID_SHAPE.test(segments[i])) return null;
      params[part.param] = segments[i];
    }
  }
  return params;
}

/** Pfad unter /api/v1 → Segmente (dekodiert); null bei Unsinn (leere Segmente, ungültige Kodierung). */
function segmentsOf(pathname: string): string[] | null {
  const rest = pathname.replace(/^\/api\/v1/, "");
  if (rest === "" || rest === "/") return [];
  const raw = rest.replace(/\/$/, "").split("/").slice(1);
  try {
    const decoded = raw.map(decodeURIComponent);
    return decoded.some((s) => s === "" || s.includes("/")) ? null : decoded;
  } catch {
    return null;
  }
}

/** Zod-Fehler → Feldfehler (Pfad mit Punkten; erster Fehler je Feld). Ohne Feldbezug: `reason`. */
export function zodProblemFields(error: z.ZodError): { fields?: ProblemFields; reason?: string } {
  const fields: ProblemFields = {};
  let reason: string | undefined;
  const put = (path: string, code: string) => {
    if (path === "") reason ??= code;
    else fields[path] ??= { code };
  };
  for (const issue of error.issues) {
    const path = issue.path.join(".");
    if (issue.code === "unrecognized_keys") for (const key of issue.keys) put([path, key].filter(Boolean).join("."), "validation.invalid");
    else if (issue.code === "invalid_type") put(path, /received undefined/.test(issue.message) ? "validation.required" : "validation.invalid");
    else if (issue.code === "too_big") put(path, "validation.tooLong");
    else if (issue.code === "custom" && /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/.test(issue.message)) put(path, issue.message);
    else put(path, "validation.invalid");
  }
  return { ...(Object.keys(fields).length ? { fields } : {}), ...(reason ? { reason } : {}) };
}

/** Liest den Körper höchstens bis `limit` Bytes (sonst 413; die Angabe `Content-Length` wird vorab geprüft, der Datenstrom zusätzlich beim Lesen). */
async function readBodyBytes(request: Request, limit: number): Promise<Buffer> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > limit) throw apiProblem("payload_too_large");
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      throw apiProblem("payload_too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function readBodyText(request: Request): Promise<string> {
  const bytes = await readBodyBytes(request, MAX_BODY_BYTES);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw apiProblem("bad_request");
  }
}

/** Zusatz zur Dateigröße für Formularfelder und Grenzen eines Uploads. */
const MULTIPART_OVERHEAD = 64 * 1024;
const MULTIPART = /^multipart\/form-data\s*;/i;

const rateHeaders = (r: { limit: number; remaining: number; resetSeconds: number }) => ({
  "ratelimit-limit": String(r.limit),
  "ratelimit-remaining": String(r.remaining),
  "ratelimit-reset": String(r.resetSeconds),
});

type Rendered = { status: number; body: string; headers: Record<string, string>; stream?: ReadableStream<Uint8Array> };

function render(result: ApiResult): Rendered {
  if (result.file) return { status: result.status, body: "", headers: { ...result.headers, ...result.file.headers }, stream: result.file.stream };
  const base = { "cache-control": "no-store", "x-content-type-options": "nosniff", ...result.headers };
  if (result.status === 204 || result.status === 304 || result.body === undefined) return { status: result.status, body: "", headers: base };
  return { status: result.status, body: JSON.stringify(result.body), headers: { ...base, "content-type": "application/json; charset=utf-8" } };
}

const toResponse = (rendered: Rendered, extra: Record<string, string> = {}): Response =>
  new Response(rendered.stream ?? (rendered.body === "" ? null : rendered.body), { status: rendered.status, headers: { ...rendered.headers, ...extra } });

/** Zu speichernde Header einer Antwort (nur, was zur Wiederholung gehört). */
const keepHeaders = (headers: Record<string, string>) => Object.fromEntries(Object.entries(headers).filter(([k]) => ["content-type", "etag", "location", "cache-control", "x-content-type-options"].includes(k)));

async function parseInput(endpoint: ApiEndpoint, request: Request, searchParams: URLSearchParams): Promise<{ query: Record<string, unknown>; body: unknown; text: string; file: ApiCall["file"] }> {
  let query: Record<string, unknown> = {};
  if (endpoint.query) {
    const raw: Record<string, string | string[]> = {};
    for (const [key, value] of searchParams) {
      if (endpoint.list && ["page", "limit", "sort"].includes(key)) continue;
      raw[key] = key in raw ? [...[raw[key]].flat(), value] : value;
    }
    const parsed = endpoint.query.safeParse(raw);
    if (!parsed.success) throw apiProblem("validation_failed", zodProblemFields(parsed.error));
    query = parsed.data as Record<string, unknown>;
  }

  let text = "";
  let body: unknown;
  let file: ApiCall["file"] = null;
  if (endpoint.upload && endpoint.method === "POST") {
    const contentType = request.headers.get("content-type") ?? "";
    if (!MULTIPART.test(contentType)) throw apiProblem("unsupported_media_type");
    const bytes = await readBodyBytes(request, endpoint.upload.maxBytes + MULTIPART_OVERHEAD);
    let form: FormData;
    try {
      form = await new Response(new Uint8Array(bytes), { headers: { "content-type": contentType } }).formData();
    } catch {
      throw apiProblem("bad_request");
    }
    const fields: Record<string, string> = {};
    for (const [name, value] of form) {
      if (typeof value === "string") fields[name] = value;
      else if (name === "file" && !file) file = { name: value.name, type: value.type, bytes: new Uint8Array(await value.arrayBuffer()) };
      else throw apiProblem("validation_failed", { fields: { [name]: { code: "validation.invalid" } } });
    }
    if (file && file.bytes.length > endpoint.upload.maxBytes) throw apiProblem("payload_too_large");
    const parsed = (endpoint.body ?? z.strictObject({})).safeParse(fields);
    if (!parsed.success) throw apiProblem("validation_failed", zodProblemFields(parsed.error));
    body = parsed.data;
    // Fingerabdruck für den Idempotency-Key: Felder und Inhalt der Datei – die Formulargrenze ist bei jedem Versuch eine andere
    text = JSON.stringify({ fields, file: file ? { name: file.name, sha256: createHash("sha256").update(file.bytes).digest("hex") } : null });
    return { query, body, text, file };
  }
  if (endpoint.method === "POST" || endpoint.method === "PATCH") {
    text = await readBodyText(request);
    if (endpoint.body) {
      if (text.trim() !== "" && !/^application\/json\s*(;.*)?$/i.test(request.headers.get("content-type") ?? "")) throw apiProblem("unsupported_media_type");
      let json: unknown = {};
      if (text.trim() !== "") {
        try {
          json = JSON.parse(text);
        } catch {
          throw apiProblem("bad_request");
        }
      }
      const parsed = endpoint.body.safeParse(json);
      if (!parsed.success) throw apiProblem("validation_failed", zodProblemFields(parsed.error));
      body = parsed.data;
    }
  }
  return { query, body, text, file };
}

export async function handleApiRequest(request: Request, endpoints: readonly ApiEndpoint[] = apiEndpoints): Promise<Response> {
  const auth = await getApiAuthenticator()(request);
  if (!auth.ok) return auth.response;

  const limit = apiLimiters.perToken.hit(auth.token.id, auth.token.rateLimitPerMinute);
  const rate = rateHeaders(limit);
  if (!limit.allowed) return problemResponse(problemOf("rate_limited"), { ...rate, "retry-after": String(limit.resetSeconds) });

  try {
    const response = await dispatch(request, auth.principal, auth.token.id, endpoints);
    for (const [name, value] of Object.entries(rate)) response.headers.set(name, value);
    return response;
  } catch (error) {
    if (error instanceof ApiProblemError) return problemResponse(error.problem, { ...rate, ...error.headers });
    logError("api", error);
    return problemResponse(problemOf("internal_error"), rate);
  }
}

async function dispatch(request: Request, principal: Principal, tokenId: string, endpoints: readonly ApiEndpoint[]): Promise<Response> {
  const url = new URL(request.url);
  const segments = segmentsOf(url.pathname);
  if (!segments) throw apiProblem("not_found");
  const method = request.method.toUpperCase();
  const pathname = `/${segments.join("/")}`;

  if (pathname === OPEN_API_PATH) {
    if (method !== "GET") throw apiProblem("method_not_allowed", undefined, { allow: "GET" });
    return toResponse(render({ status: 200, body: buildOpenApi(endpoints, principal.features) }));
  }

  const matches = compile(endpoints)
    .map((compiled) => ({ compiled, params: matchPath(compiled, segments) }))
    .filter((m): m is { compiled: Compiled; params: Record<string, string> } => m.params !== null && principal.features.has(m.compiled.endpoint.feature))
    // feste Pfade vor Platzhaltern
    .sort((a, b) => a.compiled.params - b.compiled.params);
  if (matches.length === 0) throw apiProblem("not_found");
  const match = METHODS.includes(method) ? matches.find((m) => m.compiled.endpoint.method === method) : undefined;
  if (!match) throw apiProblem("method_not_allowed", undefined, { allow: [...new Set(matches.map((m) => m.compiled.endpoint.method))].join(", ") });

  const endpoint = match.compiled.endpoint;
  if (!principal.can(endpoint.permission)) throw apiProblem("forbidden");

  const { query, body, text, file } = await parseInput(endpoint, request, url.searchParams);
  const call: ApiCall = {
    request,
    principal,
    params: match.params,
    searchParams: url.searchParams,
    query,
    body,
    ifMatch: request.headers.get("if-match"),
    ifNoneMatch: request.headers.get("if-none-match"),
    committed: () => undefined,
    file,
  };

  const key = endpoint.method === "GET" ? null : request.headers.get("idempotency-key");
  if (key === null) return toResponse(render(await runHandler(endpoint, call)));

  if (!IDEMPOTENCY_KEY_SHAPE.test(key)) throw apiProblem("validation_failed", { fields: { "Idempotency-Key": { code: "validation.invalid" } } });
  const reservation = await reserveIdempotency({ tokenId, scope: `${endpoint.method} ${pathname}`, key, bodyHash: hashBody(text, call.ifMatch) });
  if (reservation.kind === "mismatch") throw apiProblem("idempotency_key_reuse");
  if (reservation.kind === "full") throw apiProblem("rate_limited", undefined, { "retry-after": "3600" });
  if (reservation.kind === "busy") throw apiProblem("idempotency_in_progress", undefined, { "retry-after": "1" });
  if (reservation.kind === "replay") return toResponse({ status: reservation.stored.status, body: reservation.stored.body, headers: reservation.stored.headers }, { "idempotent-replayed": "true" });

  let rendered: Rendered;
  try {
    rendered = render(await runHandler(endpoint, call));
  } catch (error) {
    // Eine Fehlerantwort gibt den Schlüssel frei (die Operation hat nichts verändert); die Antwort selbst geht unverändert zurück
    await releaseIdempotency(reservation.id).catch(() => undefined);
    throw error;
  }
  // nur Erfolge festhalten (2xx); alles andere gibt frei
  if (rendered.status >= 200 && rendered.status < 300) await completeIdempotency(reservation.id, { status: rendered.status, body: rendered.body, headers: keepHeaders(rendered.headers) }).catch((error) => logError("api:idempotency", error));
  else await releaseIdempotency(reservation.id).catch(() => undefined);
  return toResponse(rendered);
}

/**
 * Ruft den Endpunkt auf. Hat er den Commit der Operation gemeldet (`call.committed`) und scheitert danach (Nachlesen …), gilt die gemeldete Mindestantwort: Die Wirkung
 * ist da, ein Fehler an dieser Stelle würde nur zu einer doppelten Ausführung durch die Wiederholung verleiten. Der Fehler wird protokolliert.
 */
async function runHandler(endpoint: ApiEndpoint, call: ApiCall): Promise<ApiResult> {
  let committed: ApiResult | undefined;
  call.committed = (result) => {
    committed = result;
  };
  try {
    return await endpoint.handler(call);
  } catch (error) {
    if (!committed) throw error;
    logError("api:afterCommit", error);
    return committed;
  }
}
