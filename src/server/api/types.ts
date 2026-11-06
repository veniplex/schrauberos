import type { z } from "zod";
import type { FeatureId, Permission } from "@/modules/catalog";
import type { Principal } from "@/server/operations";

/**
 * Typen der API-Schicht. Jede Funktion beschreibt ihre Endpunkte in der `api.ts` als `ApiEndpoint` (meist über `defineResource`,
 * `src/server/api/resource.ts`); die Pipeline (`router.ts`) kümmert sich um alles, was nicht zur Sache gehört: Token, Rate-Limit, Idempotenz,
 * Größenlimit, Fehlerformat.
 */
export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export type ApiCall = {
  request: Request;
  /** Wirksame Rechte: Scope des Tokens ∩ aktuelle Rechte des Besitzers */
  principal: Principal;
  /** Pfadparameter */
  params: Record<string, string>;
  /** Alle Abfrageparameter (für Seite/Sortierung/Filter) */
  searchParams: URLSearchParams;
  /** Geprüfte Filter (nur Listen) */
  query: Record<string, unknown>;
  /** Geprüfter Körper (POST/PATCH mit Schema), sonst undefined */
  body: unknown;
  ifMatch: string | null;
  ifNoneMatch: string | null;
};

export type ApiResult = { status: number; body?: unknown; headers?: Record<string, string> };

export type ApiEndpoint = {
  /** Gehört zu dieser Funktion: ausgeschaltet = 404 */
  feature: FeatureId;
  method: HttpMethod;
  /** Pfad unter /api/v1 mit `{param}`, z. B. "/customers/{id}" */
  path: string;
  /** Erforderliches Recht (Scope und Besitzer müssen es haben) */
  permission: Permission;
  /** Eindeutiger Name, z. B. "customers.list" */
  operationId: string;
  /** Kurzbeschreibung (englisch, erscheint in OpenAPI) */
  summary: string;
  tag: string;
  /** Namen der Operationen des Aktions-Rahmens, die der Endpunkt ausführt (Vertragstest: UI-Aktion ↔ API) */
  operations: readonly string[];
  /** Filter einer Liste (zusätzlich zu page/limit/sort) */
  query?: z.ZodObject;
  /** Sortierbare Schlüssel einer Liste */
  sorts?: readonly string[];
  /** Eingabekörper */
  body?: z.ZodObject;
  /** Schema des Ergebnisses (`data`); bei Listen das eines Elements */
  response?: z.ZodType;
  list?: boolean;
  /** Erfolgsstatus (Standard 200) */
  status?: number;
  /** Verlangt `If-Match` (Aktualisieren) */
  ifMatch?: boolean;
  /** Liefert/prüft ETag */
  etag?: boolean;
  handler: (call: ApiCall) => Promise<ApiResult>;
};
