import "server-only";
import { z } from "zod";
import { etagOf, isParamError, parseIfMatch, parsePaging, parseSort, type SortKey } from "@/lib/api/query";
import type { FeatureId, Permission } from "@/modules/catalog";
import { apiProblem, runApiOperation, type Operation, type Rename } from "@/server/operations";
import type { ApiCall, ApiEndpoint, ApiResult } from "./types";

/**
 * Baukasten für API-Ressourcen. Eine Funktion beschreibt in ihrer `api.ts` ihre Ressource (Liste, Lesen, Anlegen, Ändern, Löschen, weitere Aktionen);
 * dieser Baukasten macht daraus `ApiEndpoint`s. Schreibende Endpunkte rufen **dieselben Operationen** auf wie die Oberfläche (Recht, Eingabe der Sache,
 * Konfliktprüfung, Transaktion, Audit); nur das Eingabeschema (JSON statt Formular) ist ein eigenes.
 */

/** Was der Baukasten von einem Prisma-Modell braucht (per `as unknown as Delegate<Zeile>` zugewiesen). */
export type Delegate<Row> = {
  findMany(args: { where?: object; orderBy?: object[]; skip?: number; take?: number; include?: object }): Promise<Row[]>;
  count(args: { where?: object }): Promise<number>;
  findUnique(args: { where: { id: string }; include?: object }): Promise<Row | null>;
};

/** Bezeichner für Pfadparameter (cuid o. Ä.); alles andere gibt es nicht (404). */
export const ID_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;

type Ctx<Row> = { params: Record<string, string>; call: ApiCall; row?: Row };

export type ResourceConfig<Row, Q extends z.ZodObject, B extends z.ZodObject> = {
  feature: FeatureId;
  /** Gruppe in der OpenAPI-Beschreibung, z. B. "Customers" */
  tag: string;
  /** Kurzer Name für operationId und Beschreibung, z. B. "customers" */
  name: string;
  /** Singular für Beschreibungen, z. B. "customer" */
  singular: string;
  /** Sammlungspfad, z. B. "/customers" (Elementpfad: `<path>/{id}`) */
  path: string;
  read: Permission;
  model: Delegate<Row>;
  include?: object;
  /** Zeilen, die die API nicht zeigen darf (z. B. Krankheit): gelten überall als nicht vorhanden */
  visible?: (row: Row) => boolean;
  item: z.ZodObject;
  toItem: (row: Row) => Record<string, unknown>;
  /** Version der Zeile für ETag/If-Match (Tabellen mit `updatedAt`); ohne: keine ETags */
  version?: (row: Row) => string;
  list: {
    filters: Q;
    where?: (filters: z.output<Q>) => object;
    /** Sortierbare Schlüssel → Prisma-`orderBy` */
    sorts: Record<string, (dir: "asc" | "desc") => object>;
    defaultSort: SortKey[];
  };
  create?: {
    permission: Permission;
    operation: Operation<unknown, { id: string }>;
    body: B;
    /** API-Körper → rohe Eingabe der Operation */
    toInput: (body: z.output<B>, ctx: Ctx<Row>) => unknown;
    rename?: Rename;
  };
  update?: {
    permission: Permission;
    operation: Operation<unknown, unknown>;
    /** Körper des PATCH (Standard: `create.body.partial()`) */
    body?: z.ZodObject;
    /** Aktueller Stand der Zeile in der Form des Körpers (PATCH legt den Teil-Körper darüber) */
    current: (row: Row) => Record<string, unknown>;
    toInput: (merged: Record<string, unknown>, ctx: Ctx<Row> & { id: string; version?: string }) => unknown;
    rename?: Rename;
  };
  remove?: {
    permission: Permission;
    operation: Operation<unknown, unknown>;
    toInput?: (id: string) => unknown;
  };
  /** Weitere Aktionen am Element: POST `<path>/{id}/<name>` */
  actions?: Array<{
    name: string;
    summary: string;
    permission: Permission;
    operation: Operation<unknown, unknown>;
    body?: z.ZodObject;
    toInput: (id: string, body: Record<string, unknown>, ctx: Ctx<Row>) => unknown;
    rename?: Rename;
  }>;
};

/**
 * Leere Felder entfallen: `null`, `undefined` und leere Texte (nach dem Trimmen) – wie im Formular (`formObject`). Operationen erwarten fehlende statt leere
 * Felder; `null` im PATCH bedeutet „Wert löschen“.
 */
export function compact(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (trimmed !== "") out[key] = trimmed;
    } else out[key] = v;
  }
  return out;
}

const notFound = () => apiProblem("not_found");

export function defineResource<Row, Q extends z.ZodObject, B extends z.ZodObject>(cfg: ResourceConfig<Row, Q, B>): ApiEndpoint[] {
  const itemPath = `${cfg.path}/{id}`;
  const include = cfg.include;
  const find = async (id: string): Promise<Row | null> => {
    if (!ID_SHAPE.test(id)) return null;
    const row = await cfg.model.findUnique({ where: { id }, include });
    return row && (!cfg.visible || cfg.visible(row)) ? row : null;
  };
  const common = { feature: cfg.feature, tag: cfg.tag };

  /** Antwort für eine Zeile (Lesen, Anlegen, Ändern): Daten und ETag. */
  const itemResult = (row: Row, status: number, extra: Record<string, string> = {}): ApiResult => ({
    status,
    body: { data: cfg.toItem(row) },
    headers: { ...(cfg.version ? { etag: etagOf(cfg.version(row)) } : {}), ...extra },
  });

  const endpoints: ApiEndpoint[] = [];

  endpoints.push({
    ...common,
    method: "GET",
    path: cfg.path,
    permission: cfg.read,
    operationId: `${cfg.name}.list`,
    summary: `List ${cfg.name}`,
    operations: [],
    query: cfg.list.filters,
    sorts: Object.keys(cfg.list.sorts),
    response: cfg.item,
    list: true,
    handler: async (call) => {
      const paging = parsePaging(call.searchParams);
      const sort = parseSort(call.searchParams.get("sort"), Object.keys(cfg.list.sorts), cfg.list.defaultSort);
      for (const bad of [paging, sort]) if (isParamError(bad)) throw apiProblem("validation_failed", { fields: { [bad.field]: { code: bad.code } } });
      const { page, limit } = paging as { page: number; limit: number };
      const where = cfg.list.where?.(call.query as z.output<Q>) ?? {};
      // stabile Reihenfolge: zuletzt immer nach id
      const orderBy = [...(sort as SortKey[]).map((k) => cfg.list.sorts[k.key](k.dir)), { id: "asc" }];
      const [rows, total] = await Promise.all([cfg.model.findMany({ where, orderBy, skip: (page - 1) * limit, take: limit, include }), cfg.model.count({ where })]);
      return { status: 200, body: { data: rows.map(cfg.toItem), page: { number: page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } } };
    },
  });

  endpoints.push({
    ...common,
    method: "GET",
    path: itemPath,
    permission: cfg.read,
    operationId: `${cfg.name}.get`,
    summary: `Get a ${cfg.singular}`,
    operations: [],
    response: cfg.item,
    etag: !!cfg.version,
    handler: async (call) => {
      const row = await find(call.params.id);
      if (!row) throw notFound();
      const result = itemResult(row, 200);
      if (call.ifNoneMatch && result.headers?.etag === call.ifNoneMatch) return { status: 304, headers: result.headers };
      return result;
    },
  });

  if (cfg.create) {
    const create = cfg.create;
    endpoints.push({
      ...common,
      method: "POST",
      path: cfg.path,
      permission: create.permission,
      operationId: `${cfg.name}.create`,
      summary: `Create a ${cfg.singular}`,
      operations: [create.operation.name],
      body: create.body,
      response: cfg.item,
      status: 201,
      etag: !!cfg.version,
      handler: async (call) => {
        const raw = create.toInput(compact(call.body as Record<string, unknown>) as z.output<B>, { params: call.params, call });
        const { id } = await runApiOperation(create.operation, call.principal, raw, create.rename);
        const row = await find(id);
        if (!row) throw apiProblem("internal_error");
        return itemResult(row, 201, { location: `/api/v1${cfg.path}/${id}` });
      },
    });
  }

  if (cfg.update) {
    const update = cfg.update;
    const body = update.body ?? cfg.create?.body.partial();
    if (!body) throw new Error(`${cfg.name}: update braucht einen Körper`);
    endpoints.push({
      ...common,
      method: "PATCH",
      path: itemPath,
      permission: update.permission,
      operationId: `${cfg.name}.update`,
      summary: `Update a ${cfg.singular} (partial; send the current ETag in If-Match)`,
      operations: [update.operation.name],
      body,
      response: cfg.item,
      ifMatch: !!cfg.version,
      etag: !!cfg.version,
      handler: async (call) => {
        const id = call.params.id;
        let version: string | undefined;
        if (cfg.version) {
          const match = parseIfMatch(call.ifMatch);
          if (match.kind === "none") throw apiProblem("precondition_required");
          if (match.kind === "invalid") throw apiProblem("bad_request", { fields: { "If-Match": { code: "validation.invalid" } } });
          version = match.version;
        }
        const patch = call.body as Record<string, unknown>;
        if (Object.keys(patch).length === 0) throw apiProblem("validation_failed", { reason: "validation.required" });
        const row = await find(id);
        if (!row) throw notFound();
        const merged = compact({ ...update.current(row), ...patch });
        await runApiOperation(update.operation, call.principal, update.toInput(merged, { params: call.params, call, row, id, version }), update.rename);
        const fresh = await find(id);
        if (!fresh) throw notFound();
        return itemResult(fresh, 200);
      },
    });
  }

  if (cfg.remove) {
    const remove = cfg.remove;
    endpoints.push({
      ...common,
      method: "DELETE",
      path: itemPath,
      permission: remove.permission,
      operationId: `${cfg.name}.delete`,
      summary: `Delete a ${cfg.singular}`,
      operations: [remove.operation.name],
      status: 204,
      handler: async (call) => {
        if (!ID_SHAPE.test(call.params.id) || (cfg.visible && !(await find(call.params.id)))) throw notFound();
        await runApiOperation(remove.operation, call.principal, remove.toInput ? remove.toInput(call.params.id) : { id: call.params.id });
        return { status: 204 };
      },
    });
  }

  for (const action of cfg.actions ?? []) {
    endpoints.push({
      ...common,
      method: "POST",
      path: `${itemPath}/${action.name}`,
      permission: action.permission,
      operationId: `${cfg.name}.${action.name}`,
      summary: action.summary,
      operations: [action.operation.name],
      body: action.body,
      response: cfg.item,
      etag: !!cfg.version,
      handler: async (call) => {
        const row = await find(call.params.id);
        if (!row) throw notFound();
        const raw = action.toInput(call.params.id, compact((call.body ?? {}) as Record<string, unknown>), { params: call.params, call, row });
        await runApiOperation(action.operation, call.principal, raw, action.rename);
        const fresh = await find(call.params.id);
        if (!fresh) throw notFound();
        return itemResult(fresh, 200);
      },
    });
  }

  return endpoints;
}
