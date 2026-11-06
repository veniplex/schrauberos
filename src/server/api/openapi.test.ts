import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { FEATURES, fullFeatureId } from "@/modules/catalog";
import { createTestEnv, type TestEnv } from "@/test/harness";
import type { ApiEndpoint } from "./types";

/**
 * OpenAPI 3.1 aus den Schemas: Aufbau, Verweise, Determinismus und eine Struktur-Momentaufnahme (`openapi-structure.txt`) – eine Änderung der API-Oberfläche
 * fällt damit im Review auf. Aktualisieren: `UPDATE_API_SNAPSHOT=1 npx tsx --test src/server/api/openapi.test.ts`.
 */
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let env: TestEnv;
let build: typeof import("./openapi").buildOpenApi;
let endpoints: readonly ApiEndpoint[];
const allFeatures = new Set(FEATURES.map(fullFeatureId));

before(async () => {
  env = await createTestEnv();
  build = (await import("./openapi")).buildOpenApi;
  endpoints = (await import("@/modules/api")).apiEndpoints;
});
after(() => env.cleanup());

const refs = (node: unknown, out: string[] = []): string[] => {
  if (Array.isArray(node)) node.forEach((n) => refs(n, out));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) {
      if (k === "$ref") out.push(String(v));
      else refs(v, out);
    }
  return out;
};
const keysDeep = (node: unknown, out = new Set<string>()): Set<string> => {
  if (Array.isArray(node)) node.forEach((n) => keysDeep(n, out));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) {
      out.add(k);
      keysDeep(v, out);
    }
  return out;
};

describe("OpenAPI-Erzeugung", () => {
  it("ist ein gültiges 3.1-Dokument: Verweise lösen auf, Pfadparameter sind deklariert, keine Reste von JSON-Schema-Kopfzeilen", () => {
    const doc = build(endpoints, allFeatures) as Json;
    assert.equal(doc.openapi, "3.1.0");
    assert.deepEqual(doc.security, [{ bearerAuth: [] }]);
    assert.equal(doc.components.securitySchemes.bearerAuth.scheme, "bearer");
    for (const ref of refs(doc)) {
      const target = ref.replace(/^#\//, "").split("/").reduce<unknown>((n, part) => (n as Json)?.[part], doc);
      assert.ok(target, `Verweis ${ref} löst nicht auf`);
    }
    assert.ok(!keysDeep(doc).has("$schema"));
    for (const [route, methods] of Object.entries(doc.paths as Record<string, Json>)) {
      const placeholders = [...route.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      for (const [method, op] of Object.entries(methods)) {
        const declared = (op.parameters as Json[]).filter((p) => p.in === "path").map((p) => p.name);
        assert.deepEqual(declared, placeholders, `${method} ${route}`);
        for (const code of ["401", "403", "429"]) assert.ok(op.responses[code], `${method} ${route}: ${code}`);
        if (method === "post" || method === "patch") {
          const schema = op.requestBody?.content?.["application/json"]?.schema as Json | undefined;
          if (op.requestBody) assert.equal(schema?.additionalProperties, false, `${method} ${route}: unbekannte Felder müssen abgelehnt werden`);
        }
        if (method === "patch") assert.equal((op.parameters as Json[]).some((p) => p.name === "If-Match"), !!op.responses["412"], `${route}: If-Match genau bei versionierten Ressourcen`);
      }
    }
  });

  it("enthält keine Interna: keine Datenbankbegriffe, Pfade oder Geheimnisse, nur Struktur", () => {
    const text = JSON.stringify(build(endpoints, allFeatures));
    for (const forbidden of ["tokenHash", "passwordHash", "prisma", "sqlite", "C:\\\\", "/data/", "node_modules", "emergency", "userId"]) assert.ok(!text.includes(forbidden), forbidden);
  });

  it("ist deterministisch und unabhängig von der Reihenfolge der Registrierung; ausgeschaltete Funktionen fehlen", () => {
    const a = JSON.stringify(build(endpoints, allFeatures));
    assert.equal(a, JSON.stringify(build(endpoints, allFeatures)));
    assert.equal(a, JSON.stringify(build([...endpoints].reverse(), allFeatures)));
    const without = new Set([...allFeatures].filter((f) => f !== "office.fleet"));
    const paths = Object.keys((build(endpoints, without) as Json).paths);
    assert.ok(!paths.some((p) => p.startsWith("/fleet-")));
    assert.ok(paths.includes("/customers"));
  });

  it("Struktur-Momentaufnahme: Endpunkte, Rechte, Filter und Sortierungen (openapi-structure.txt)", () => {
    const doc = build(endpoints, allFeatures) as Json;
    const lines: string[] = [];
    for (const [route, methods] of Object.entries(doc.paths as Record<string, Json>)) {
      for (const [method, op] of Object.entries(methods)) {
        const query = (op.parameters as Json[]).filter((p) => p.in === "query" && !["page", "limit", "sort"].includes(p.name)).map((p) => p.name);
        const sort = ((op.parameters as Json[]).find((p) => p.name === "sort")?.description as string | undefined)?.replace(/^.*Allowed: /, "").replace(/\.$/, "");
        const body = op.requestBody ? Object.keys(op.requestBody.content["application/json"].schema.properties ?? {}).join(",") : "";
        lines.push(`${method.toUpperCase()} ${route} ${op.operationId} ${op["x-required-permission"]}${query.length ? ` query=${query.join(",")}` : ""}${sort ? ` sort=${sort.replace(/, /g, ",")}` : ""}${body ? ` body=${body}` : ""}`);
      }
    }
    const actual = `${lines.join("\n")}\n`;
    const file = path.join(process.cwd(), "src", "server", "api", "openapi-structure.txt");
    if (process.env.UPDATE_API_SNAPSHOT === "1" || !existsSync(file)) writeFileSync(file, actual);
    assert.equal(actual, readFileSync(file, "utf8").replace(/\r\n/g, "\n"), "Die API-Oberfläche hat sich geändert: Momentaufnahme mit UPDATE_API_SNAPSHOT=1 erneuern und im Review prüfen");
  });
});
