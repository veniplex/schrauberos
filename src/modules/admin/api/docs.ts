/**
 * Darstellungsmodell der Doku-Seite aus der OpenAPI-Beschreibung (reine Logik, getestet): Endpunkte je Ressource (Tag) mit Recht, Parametern, Feldern von Körper und Antwort und einem curl-Beispiel
 * mit **Platzhalter-Token** (nie ein echtes). Die Seite rendert das serverseitig – kein Swagger-UI/Redoc (CSP, Gewicht).
 */
type Json = Record<string, unknown>;

export type DocField = { name: string; type: string; required: boolean };
export type DocParam = { name: string; where: string; required: boolean; type: string; description?: string };
export type DocOperation = {
  id: string;
  method: string;
  path: string;
  summary: string;
  permission: string;
  params: DocParam[];
  body: DocField[] | null;
  bodyKind: "json" | "multipart" | null;
  response: DocField[] | null;
  list: boolean;
  success: string;
  download: boolean;
  /** Beschreibung eines Downloads (Typ, Schutz-Kopfzeilen) aus der OpenAPI-Beschreibung */
  downloadNote: string;
  curl: string;
};
export type DocGroup = { tag: string; operations: DocOperation[] };

const obj = (value: unknown): Json => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {});

/** Kurze Typbeschreibung eines JSON-Schemas (`string`, `integer`, `a | b`, `string | null`, `object[]` …). */
export function typeOf(schema: Json): string {
  if (Array.isArray(schema.enum)) {
    const text = schema.enum.map(String).join(" | ");
    return text.length > 140 ? `${text.slice(0, 137)}…` : text;
  }
  if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
    const options = ((schema.anyOf ?? schema.oneOf) as unknown[]).map(obj);
    const nullable = options.some((o) => o.type === "null");
    const rest = options.filter((o) => o.type !== "null").map(typeOf);
    return [...rest, ...(nullable ? ["null"] : [])].join(" | ") || "any";
  }
  const type = schema.type;
  if (type === "array") return `${typeOf(obj(schema.items))}[]`;
  if (Array.isArray(type)) return type.map(String).join(" | ");
  const base = typeof type === "string" ? type : "any";
  return typeof schema.format === "string" && base === "string" ? `string (${schema.format})` : base;
}

/** Felder eines Objekt-Schemas. */
export function fieldsOf(schema: Json): DocField[] {
  const properties = obj(schema.properties);
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  return Object.entries(properties).map(([name, value]) => ({ name, type: typeOf(obj(value)), required: required.has(name) }));
}

/** Beispielwert zu einem Schema (für den Körper im curl-Beispiel): erster Aufzählungswert, sonst ein Platzhalter nach Typ. */
function sample(schema: Json): unknown {
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (Array.isArray(schema.anyOf)) return sample(obj((schema.anyOf as unknown[]).map(obj).find((o) => o.type !== "null") ?? {}));
  switch (schema.type) {
    case "string":
      return schema.format === "date-time" ? "2026-01-31T09:00:00Z" : "…";
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return false;
    case "array":
      return [];
    case "object":
      return {};
    default:
      return null;
  }
}

function exampleBody(schema: Json): string {
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(obj(schema.properties))) if (required.has(name)) out[name] = sample(obj(value));
  return JSON.stringify(out);
}

/** curl-Aufruf mit Platzhaltern (`<TOKEN>`, `<id>`, `<etag>`): schreibende Aufrufe tragen `Idempotency-Key`, Änderungen `If-Match`. */
export function curlOf(method: string, path: string, base: string, bodySchema: Json | null, bodyKind: "json" | "multipart" | null, ifMatch: boolean): string {
  const url = `${base}/api/v1${path.replace(/\{(\w+)\}/g, "<$1>")}`;
  const lines = [`curl -X ${method} "${url}"`, `  -H "Authorization: Bearer <TOKEN>"`];
  if (method !== "GET") lines.push(`  -H "Idempotency-Key: $(uuidgen)"`);
  if (ifMatch) lines.push(`  -H 'If-Match: "<etag>"'`);
  if (bodyKind === "json" && bodySchema) {
    lines.push(`  -H "Content-Type: application/json"`);
    lines.push(`  -d '${exampleBody(bodySchema)}'`);
  } else if (bodyKind === "multipart" && bodySchema) {
    for (const [name, value] of Object.entries(obj(bodySchema.properties))) {
      if (name === "file") lines.push(`  -F "file=@datei.jpg"`);
      else if ((Array.isArray(bodySchema.required) ? (bodySchema.required as string[]) : []).includes(name)) lines.push(`  -F "${name}=${String(sample(obj(value)))}"`);
    }
  }
  return lines.join(" \\\n");
}

const METHODS = ["get", "post", "patch", "delete"] as const;

/** Die Beschreibung (`buildOpenApi`) → Gruppen je Tag, Endpunkte in der Reihenfolge der Beschreibung (Pfad, Methode). */
export function docModel(doc: Json, base: string): DocGroup[] {
  const groups = new Map<string, DocOperation[]>();
  for (const [path, item] of Object.entries(obj(doc.paths))) {
    for (const method of METHODS) {
      const operation = obj(obj(item)[method]);
      if (Object.keys(operation).length === 0) continue;
      const tag = String((operation.tags as unknown[] | undefined)?.[0] ?? "API");
      const params = ((operation.parameters as unknown[] | undefined) ?? []).map(obj).filter((p) => p.name !== "Idempotency-Key" && p.name !== "If-None-Match");
      const request = obj(operation.requestBody);
      const content = obj(request.content);
      const bodyKind = "application/json" in content ? "json" : "multipart/form-data" in content ? "multipart" : null;
      const bodySchema = bodyKind ? obj(obj(content[bodyKind === "json" ? "application/json" : "multipart/form-data"]).schema) : null;
      const responses = obj(operation.responses);
      const success = Object.keys(responses).find((status) => /^2\d\d$/.test(status)) ?? "200";
      const successContent = obj(obj(responses[success]).content);
      const download = "application/octet-stream" in successContent;
      const successSchema = obj(obj(successContent["application/json"]).schema);
      const data = obj(obj(successSchema.properties).data);
      const list = data.type === "array";
      const itemSchema = list ? obj(data.items) : data;
      const response = !download && Object.keys(itemSchema).length > 0 ? fieldsOf(itemSchema) : null;
      const ifMatch = params.some((p) => p.name === "If-Match");
      const entry: DocOperation = {
        id: String(operation.operationId ?? `${method}${path}`),
        method: method.toUpperCase(),
        path,
        summary: String(operation.summary ?? ""),
        permission: [String(operation["x-required-permission"] ?? ""), ...((operation["x-also-requires"] as string[] | undefined) ?? [])].join(" + "),
        params: params.map((p) => ({ name: String(p.name), where: String(p.in), required: p.required === true, type: typeOf(obj(p.schema)), ...(typeof p.description === "string" ? { description: p.description } : {}) })),
        body: bodySchema ? fieldsOf(bodySchema) : null,
        bodyKind,
        response,
        list,
        success,
        download,
        downloadNote: download && typeof operation.description === "string" ? operation.description : "",
        curl: curlOf(method.toUpperCase(), path, base, bodySchema, bodyKind, ifMatch),
      };
      groups.set(tag, [...(groups.get(tag) ?? []), entry]);
    }
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([tag, operations]) => ({ tag, operations }));
}
