import "server-only";
import { z } from "zod";
import { DEFAULT_LIMIT, MAX_LIMIT } from "@/lib/api/query";
import { PROBLEMS } from "@/lib/api/problem";
import type { ApiEndpoint } from "./types";

/**
 * OpenAPI 3.1 aus den Schemas der Endpunkte (zod → JSON Schema). Deterministisch (Pfade und Methoden sortiert, keine Zeitstempel) und ohne Interna:
 * nur Struktur, nur Endpunkte **aktiver** Funktionen, keine Daten. Ausgeliefert unter `/api/v1/openapi.json` (gültiges Token erforderlich).
 */
export const API_DOC_VERSION = "1.0.0";
const METHOD_ORDER = ["get", "post", "patch", "delete"];

type Json = Record<string, unknown>;

function schemaOf(schema: z.ZodType, io: "input" | "output"): Json {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12", io, unrepresentable: "any" }) as Json;
  delete json.$schema;
  return json;
}

/** Header, die jede Antwort nach der Authentifizierung trägt (Rate-Limit je Token). */
const RATE_HEADERS: Json = {
  "RateLimit-Limit": { $ref: "#/components/headers/RateLimitLimit" },
  "RateLimit-Remaining": { $ref: "#/components/headers/RateLimitRemaining" },
  "RateLimit-Reset": { $ref: "#/components/headers/RateLimitReset" },
};

const problemRef = (description: string, headers: Json = RATE_HEADERS): Json => ({
  description,
  headers,
  content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
});

const PROBLEM_SCHEMA: Json = {
  type: "object",
  required: ["type", "title", "status", "code", "detail"],
  properties: {
    type: { type: "string" },
    title: { type: "string" },
    status: { type: "integer" },
    code: { type: "string", enum: Object.keys(PROBLEMS) },
    detail: { type: "string" },
    fields: { type: "object", additionalProperties: { type: "object", required: ["code"], properties: { code: { type: "string" }, params: { type: "object" } } } },
    reason: { type: "string" },
    params: { type: "object" },
  },
};

const PAGE_SCHEMA: Json = {
  type: "object",
  required: ["number", "limit", "total", "pages"],
  properties: { number: { type: "integer", minimum: 1 }, limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT }, total: { type: "integer", minimum: 0 }, pages: { type: "integer", minimum: 1 } },
};

function operationOf(endpoint: ApiEndpoint): Json {
  const parameters: Json[] = [...endpoint.path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
  if (endpoint.list) {
    parameters.push(
      { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
      { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT } },
      {
        name: "sort",
        in: "query",
        description: `Comma-separated keys, prefix a key with "-" for descending. Allowed: ${(endpoint.sorts ?? []).join(", ")}.`,
        schema: { type: "string" },
      },
    );
  }
  if (endpoint.query) {
    const shape = schemaOf(endpoint.query, "input");
    const required = new Set((shape.required as string[] | undefined) ?? []);
    for (const [name, schema] of Object.entries((shape.properties as Json | undefined) ?? {})) parameters.push({ name, in: "query", required: required.has(name), schema });
  }
  if (endpoint.ifMatch) parameters.push({ name: "If-Match", in: "header", required: true, description: "ETag of the version being changed.", schema: { type: "string" } });
  if (endpoint.etag && endpoint.method === "GET") {
    parameters.push({
      name: "If-None-Match",
      in: "header",
      description: "ETag(s) the client already has (a list, weak validators and * are understood); an unchanged resource answers 304 without a body.",
      schema: { type: "string" },
    });
  }
  if (endpoint.method !== "GET") parameters.push({ name: "Idempotency-Key", in: "header", description: "Makes retries safe: the same key with the same body returns the stored response.", schema: { type: "string", maxLength: 128 } });

  const data = endpoint.response && !endpoint.download ? schemaOf(endpoint.response, "output") : undefined;
  const ok = endpoint.status ?? 200;
  const success: Json = { description: ok === 204 ? "No content" : "Success" };
  const successHeaders: Json = { ...RATE_HEADERS };
  if (data && ok !== 204) {
    success.content = {
      "application/json": {
        schema: endpoint.list
          ? { type: "object", required: ["data", "page"], properties: { data: { type: "array", items: data }, page: { $ref: "#/components/schemas/Page" } } }
          : { type: "object", required: ["data"], properties: { data } },
      },
    };
    if (endpoint.etag) successHeaders.ETag = { $ref: "#/components/headers/ETag" };
  }
  // 201 nennt den Ort des neuen Elements
  if (ok === 201) successHeaders.Location = { $ref: "#/components/headers/Location" };
  // Dateien: Antwort mit dem Inhalt der Datei (ihr Typ steht im Header Content-Type), kein JSON
  if (endpoint.download) success.content = { "application/octet-stream": { schema: { type: "string", format: "binary" } } };
  success.headers = successHeaders;

  const hasBody = !!endpoint.body && !endpoint.upload;
  const writes = endpoint.method !== "GET";
  const responses: Record<string, Json> = {
    [String(ok)]: success,
    "401": { $ref: "#/components/responses/Unauthenticated" },
    "403": { $ref: "#/components/responses/Forbidden" },
    "404": { $ref: "#/components/responses/NotFound" },
    "405": { $ref: "#/components/responses/MethodNotAllowed" },
    "429": { $ref: "#/components/responses/RateLimited" },
  };
  // 304: nur Elemente mit ETag
  if (endpoint.etag && endpoint.method === "GET") responses["304"] = { description: "Not modified: the client's ETag is current.", headers: { ...RATE_HEADERS, ETag: { $ref: "#/components/headers/ETag" } } };
  // 400 bei unlesbarem Körper/If-Match, 413/415 bei Körpern
  if (hasBody || endpoint.upload || endpoint.ifMatch) responses["400"] = problemRef("The request could not be understood (malformed JSON, invalid If-Match).");
  if (hasBody || endpoint.upload) {
    responses["413"] = problemRef(endpoint.upload ? `The upload is larger than ${Math.round(endpoint.upload.maxBytes / 1_048_576)} MiB.` : "The request body is larger than 1 MiB.");
    responses["415"] = problemRef(endpoint.upload ? "The body is not multipart/form-data." : "The body is not application/json.");
  }
  // 422: ungültige Eingabe/Filter; bei schreibenden Aufrufen auch Idempotency-Key ungültig oder wiederverwendet
  if (hasBody || endpoint.query || endpoint.list || writes) responses["422"] = { $ref: "#/components/responses/Validation" };
  if (endpoint.ifMatch) {
    responses["412"] = problemRef("The resource was changed by someone else.");
    responses["428"] = problemRef("If-Match is required.");
  }
  // 409: Eindeutigkeit/„wird noch verwendet“ bei jedem schreibenden Aufruf; zusätzlich "Idempotency-Key in Arbeit"
  if (writes) responses["409"] = problemRef("Conflict with existing data, the resource is still in use, or a request with the same Idempotency-Key is still being processed.");
  if (writes) responses["503"] = problemRef("The database is busy; retry shortly.", { ...RATE_HEADERS, "Retry-After": { $ref: "#/components/headers/RetryAfter" } });

  const operation: Json = {
    operationId: endpoint.operationId,
    summary: endpoint.summary,
    tags: [endpoint.tag],
    "x-required-permission": endpoint.permission,
    ...(endpoint.alsoRequires?.length ? { "x-also-requires": [...endpoint.alsoRequires] } : {}),
    parameters,
    responses,
  };
  if (endpoint.upload) {
    const fields = endpoint.body ? schemaOf(endpoint.body, "input") : { type: "object", properties: {} };
    const required = [...(((fields.required as string[] | undefined) ?? [])), "file"];
    operation.requestBody = {
      required: true,
      content: { "multipart/form-data": { schema: { ...fields, type: "object", required, properties: { ...((fields.properties as Json | undefined) ?? {}), file: { type: "string", format: "binary" } } } } },
    };
  } else if (endpoint.body) operation.requestBody = { required: true, content: { "application/json": { schema: schemaOf(endpoint.body, "input") } } };
  if (endpoint.download) operation.description = endpoint.download.description;
  return operation;
}

export function buildOpenApi(endpoints: readonly ApiEndpoint[], activeFeatures: ReadonlySet<string>): Json {
  const active = endpoints.filter((e) => activeFeatures.has(e.feature));
  const paths: Record<string, Record<string, Json>> = {};
  for (const endpoint of [...active].sort((a, b) => a.path.localeCompare(b.path) || METHOD_ORDER.indexOf(a.method.toLowerCase()) - METHOD_ORDER.indexOf(b.method.toLowerCase()))) {
    (paths[endpoint.path] ??= {})[endpoint.method.toLowerCase()] = operationOf(endpoint);
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "SchrauberOS API",
      version: API_DOC_VERSION,
      description:
        "Authenticate with `Authorization: Bearer <token>`. Money is always integer cents. Dates are real calendar days `YYYY-MM-DD` (workshop time zone; 2026-02-30 is rejected with 422), timestamps ISO 8601. Updates use ETag / If-Match; retries are safe with Idempotency-Key (only successful responses are stored, for 24 hours). Every response after authentication carries RateLimit-Limit / RateLimit-Remaining / RateLimit-Reset; 429 adds Retry-After. Unsupported methods answer 405 with an Allow header.",
    },
    servers: [{ url: "/api/v1" }],
    security: [{ bearerAuth: [] }],
    tags: [...new Set(active.map((e) => e.tag))].sort().map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      schemas: { Problem: PROBLEM_SCHEMA, Page: PAGE_SCHEMA },
      headers: {
        RateLimitLimit: { description: "Requests allowed per minute for this token.", schema: { type: "integer" } },
        RateLimitRemaining: { description: "Requests left in the current window.", schema: { type: "integer" } },
        RateLimitReset: { description: "Seconds until the window resets.", schema: { type: "integer" } },
        RetryAfter: { description: "Seconds to wait before retrying.", schema: { type: "integer" } },
        ETag: { description: "Version of the resource; send it in If-Match when changing it.", schema: { type: "string" } },
        Location: { description: "Path of the created resource.", schema: { type: "string" } },
        Allow: { description: "Methods supported on this path.", schema: { type: "string" } },
      },
      responses: {
        Unauthenticated: problemRef("Missing, invalid, expired or revoked token.", { "WWW-Authenticate": { schema: { type: "string" } } }),
        Forbidden: problemRef("The token's rights do not allow this."),
        NotFound: problemRef("The resource does not exist."),
        MethodNotAllowed: problemRef("The method is not supported on this path.", { ...RATE_HEADERS, Allow: { $ref: "#/components/headers/Allow" } }),
        Validation: problemRef("The request contains invalid data."),
        RateLimited: problemRef("Rate limit exceeded; see Retry-After.", { ...RATE_HEADERS, "Retry-After": { $ref: "#/components/headers/RetryAfter" } }),
      },
    },
  };
}
