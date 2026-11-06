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

const problemRef = (description: string): Json => ({ description, content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } } });

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
  if (endpoint.method !== "GET") parameters.push({ name: "Idempotency-Key", in: "header", description: "Makes retries safe: the same key with the same body returns the stored response.", schema: { type: "string", maxLength: 128 } });

  const data = endpoint.response ? schemaOf(endpoint.response, "output") : undefined;
  const ok = endpoint.status ?? 200;
  const success: Json = { description: ok === 204 ? "No content" : "Success" };
  if (data && ok !== 204) {
    success.content = {
      "application/json": {
        schema: endpoint.list
          ? { type: "object", required: ["data", "page"], properties: { data: { type: "array", items: data }, page: { $ref: "#/components/schemas/Page" } } }
          : { type: "object", required: ["data"], properties: { data } },
      },
    };
    if (endpoint.etag) success.headers = { ETag: { schema: { type: "string" } } };
  }

  const responses: Record<string, Json> = {
    [String(ok)]: success,
    "401": { $ref: "#/components/responses/Unauthenticated" },
    "403": { $ref: "#/components/responses/Forbidden" },
    "404": { $ref: "#/components/responses/NotFound" },
    "429": { $ref: "#/components/responses/RateLimited" },
  };
  if (endpoint.body || endpoint.query || endpoint.list) responses["422"] = { $ref: "#/components/responses/Validation" };
  if (endpoint.ifMatch) {
    responses["412"] = problemRef("The resource was changed by someone else.");
    responses["428"] = problemRef("If-Match is required.");
  }
  if (endpoint.method === "POST" || endpoint.method === "DELETE") responses["409"] = problemRef("Conflict with existing data, or the resource is still in use.");

  const operation: Json = {
    operationId: endpoint.operationId,
    summary: endpoint.summary,
    tags: [endpoint.tag],
    "x-required-permission": endpoint.permission,
    parameters,
    responses,
  };
  if (endpoint.body) operation.requestBody = { required: true, content: { "application/json": { schema: schemaOf(endpoint.body, "input") } } };
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
        "Authenticate with `Authorization: Bearer <token>`. Money is always integer cents. Dates are `YYYY-MM-DD` (workshop time zone), timestamps ISO 8601. Updates use ETag / If-Match; retries are safe with Idempotency-Key.",
    },
    servers: [{ url: "/api/v1" }],
    security: [{ bearerAuth: [] }],
    tags: [...new Set(active.map((e) => e.tag))].sort().map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      schemas: { Problem: PROBLEM_SCHEMA, Page: PAGE_SCHEMA },
      responses: {
        Unauthenticated: problemRef("Missing, invalid, expired or revoked token."),
        Forbidden: problemRef("The token's rights do not allow this."),
        NotFound: problemRef("The resource does not exist."),
        Validation: problemRef("The request contains invalid data."),
        RateLimited: problemRef("Rate limit exceeded; see Retry-After."),
      },
    },
  };
}
