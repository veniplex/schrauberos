import { Readable } from "node:stream";
import { z } from "zod";
import { etagOf, ifNoneMatchHit, isParamError, parseIfMatch, parsePaging, parseSort } from "@/lib/api/query";
import { deliveryHeaders } from "@/lib/file-delivery";
import { iso, nullableString, text } from "@/server/api/format";
import { ID_SHAPE } from "@/server/api/resource";
import type { ApiEndpoint } from "@/server/api/types";
import { fileExists, fileSize, openFile } from "@/server/files";
import { apiProblem, runApiOperation } from "@/server/operations";
import { FILE_CATEGORIES, FILE_MAX_BYTES, FILE_OWNER_TYPES } from "./constants";
import { archiveFileOperation, updateFileOperation, uploadFileOperation } from "./operations";
import { fileForDelivery, getFile, listFiles, type FileRow } from "./queries";

/**
 * API-Ressource `/files` (Dokumente & Fotos an Fahrzeugen und Aufträgen):
 *  - `GET /files`, `GET /files/{id}`: Metadaten; sichtbar ist, was die Rechte des Tokens für Fahrzeug bzw. Auftrag und `files.view` ergeben – Dateien von Kunden mit eingeschränkter Verarbeitung (Art. 18)
 *    und entfernte Dateien gibt es nicht (404),
 *  - `GET /files/{id}/content`: der Inhalt als Binärantwort (Foto/PDF; Kopfzeile `nosniff`, Content-Disposition mit Dateiname; die Content-Security-Policy ist im Betrieb die des Proxys für `/api/v1` (`default-src 'none'; frame-ancestors 'none'`: es läuft nichts), die `sandbox`-Richtlinie von `deliveryHeaders` gilt nur, wo kein Proxy davorsteht (Next verwirft den Kopf einer Route still, wenn der Proxy ihn schon gesetzt hat)),
 *  - `POST /files`: **Multipart-Upload** (`multipart/form-data`: `ownerType`, `ownerId`, `category`, `caption` und die Datei im Feld `file`) – dieselbe Operation wie in der Oberfläche: Inhalt statt gemeldetem Typ,
 *    Bildpunktgrenze, **Exif/GPS wird auch hier serverseitig entfernt**; der `Idempotency-Key` verhindert Dubletten,
 *  - `PATCH /files/{id}` (Beschriftung, Art; `If-Match`) und `DELETE /files/{id}` (Entfernen = Archivieren; die Datei bleibt unverändert auf dem Datenträger).
 */

const itemShape = z.object({
  id: z.string(),
  version: z.string(),
  ownerType: z.enum(FILE_OWNER_TYPES),
  ownerId: z.string(),
  category: z.enum(FILE_CATEGORIES),
  caption: nullableString,
  name: z.string(),
  mime: z.string(),
  size: z.number().int(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  uploadedByName: z.string(),
  createdAt: z.string(),
  /** Pfad der Binärantwort */
  contentUrl: z.string(),
});

const toItem = (row: FileRow): z.input<typeof itemShape> => ({
  id: row.id,
  version: row.version,
  ownerType: row.ownerType,
  ownerId: row.ownerId,
  category: (FILE_CATEGORIES as readonly string[]).includes(row.category) ? (row.category as (typeof FILE_CATEGORIES)[number]) : "other",
  caption: row.caption,
  name: row.name,
  mime: row.mime,
  size: row.size,
  width: row.width,
  height: row.height,
  uploadedByName: row.uploadedByName,
  createdAt: iso(row.createdAt),
  contentUrl: `/api/v1/files/${row.id}/content`,
});

const common = { feature: "workshop.files" as const, tag: "Files" };
const SORTS = ["createdAt"] as const;

export const endpoints: ApiEndpoint[] = [
  {
    ...common,
    method: "GET",
    path: "/files",
    permission: "files.view",
    operationId: "files.list",
    summary: "List files and photos of vehicles and orders (only those the token may see)",
    operations: [],
    query: z.strictObject({ ownerType: z.enum(FILE_OWNER_TYPES).optional(), ownerId: z.string().max(64).optional(), category: z.enum(FILE_CATEGORIES).optional(), q: z.string().max(100).optional() }),
    sorts: SORTS,
    response: itemShape,
    list: true,
    handler: async (call) => {
      const paging = parsePaging(call.searchParams);
      const sort = parseSort(call.searchParams.get("sort"), SORTS, [{ key: "createdAt", dir: "desc" }]);
      for (const bad of [paging, sort]) if (isParamError(bad)) throw apiProblem("validation_failed", { fields: { [bad.field]: { code: bad.code } } });
      const { page, limit } = paging as { page: number; limit: number };
      const q = call.query as { ownerType?: "vehicle" | "order"; ownerId?: string; category?: string; q?: string };
      const { rows, total } = await listFiles(call.principal, q, { skip: (page - 1) * limit, take: limit });
      const ordered = (sort as Array<{ dir: string }>)[0]?.dir === "asc" ? [...rows].reverse() : rows;
      return { status: 200, body: { data: ordered.map(toItem), page: { number: page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } } };
    },
  },
  {
    ...common,
    method: "GET",
    path: "/files/{id}",
    permission: "files.view",
    operationId: "files.get",
    summary: "Get the metadata of a file",
    operations: [],
    response: itemShape,
    etag: true,
    handler: async (call) => {
      if (!ID_SHAPE.test(call.params.id)) throw apiProblem("not_found");
      const row = await getFile(call.principal, call.params.id);
      if (!row) throw apiProblem("not_found");
      const etag = etagOf(row.version);
      if (ifNoneMatchHit(call.ifNoneMatch, etag)) return { status: 304, headers: { etag } };
      return { status: 200, body: { data: toItem(row) }, headers: { etag } };
    },
  },
  {
    ...common,
    method: "GET",
    path: "/files/{id}/content",
    permission: "files.view",
    operationId: "files.content",
    summary: "Download the file itself (binary; add ?download=1 to force a download)",
    operations: [],
    download: { description: "The file's bytes. Content-Type is the detected type (image/jpeg, image/png or application/pdf); the response carries nosniff and a restrictive Content-Security-Policy (default-src 'none': nothing executes). Metadata such as Exif/GPS was removed when the photo was uploaded." },
    handler: async (call) => {
      if (!ID_SHAPE.test(call.params.id)) throw apiProblem("not_found");
      const file = await fileForDelivery(call.principal, call.params.id);
      if (!file || !fileExists(file.path)) throw apiProblem("not_found");
      const headers = deliveryHeaders({ mime: file.mime, name: file.name, size: fileSize(file.path), download: call.searchParams.get("download") === "1", cacheControl: "private, no-store" });
      return { status: 200, file: { stream: Readable.toWeb(openFile(file.path)) as ReadableStream<Uint8Array>, headers } };
    },
  },
  {
    ...common,
    method: "POST",
    path: "/files",
    permission: "files.upload",
    operationId: "files.upload",
    summary: "Upload a photo (JPEG, PNG) or a PDF to a vehicle or an open order (multipart/form-data; Exif/GPS is removed on the server; the Idempotency-Key prevents duplicates)",
    operations: [uploadFileOperation.name],
    body: z.strictObject({ ownerType: z.enum(FILE_OWNER_TYPES), ownerId: z.string().min(1).max(64), category: z.enum(FILE_CATEGORIES).optional(), caption: text(200) }),
    upload: { maxBytes: FILE_MAX_BYTES },
    response: itemShape,
    status: 201,
    etag: true,
    handler: async (call) => {
      if (!call.file) throw apiProblem("validation_failed", { fields: { file: { code: "validation.required" } } });
      const body = call.body as { ownerType: "vehicle" | "order"; ownerId: string; category?: string; caption?: string | null };
      const key = call.request.headers.get("idempotency-key");
      const { id } = await runApiOperation(
        uploadFileOperation,
        call.principal,
        { ownerType: body.ownerType, ownerId: body.ownerId, ...(body.category ? { category: body.category } : {}), ...(body.caption ? { caption: body.caption } : {}), name: call.file.name || "datei", declaredType: call.file.type, bytes: call.file.bytes, ...(key ? { uploadKey: key } : {}) },
        { file: "file" },
      );
      call.committed({ status: 201, body: { data: { id } }, headers: { location: `/api/v1/files/${id}` } });
      const row = await getFile(call.principal, id);
      if (!row) throw apiProblem("internal_error");
      return { status: 201, body: { data: toItem(row) }, headers: { location: `/api/v1/files/${id}`, etag: etagOf(row.version) } };
    },
  },
  {
    ...common,
    method: "PATCH",
    path: "/files/{id}",
    permission: "files.view",
    operationId: "files.update",
    summary: "Change the caption and category of a file (send the current ETag in If-Match)",
    operations: [updateFileOperation.name],
    body: z.strictObject({ category: z.enum(FILE_CATEGORIES).optional(), caption: text(200) }),
    response: itemShape,
    ifMatch: true,
    etag: true,
    handler: async (call) => {
      if (!ID_SHAPE.test(call.params.id)) throw apiProblem("not_found");
      const match = parseIfMatch(call.ifMatch);
      if (match.kind === "none") throw apiProblem("precondition_required");
      if (match.kind === "invalid") throw apiProblem("bad_request", { fields: { "If-Match": { code: "validation.invalid" } } });
      const patch = call.body as { category?: string; caption?: string | null };
      if (Object.keys(patch).length === 0) throw apiProblem("validation_failed", { reason: "validation.required" });
      const row = await getFile(call.principal, call.params.id);
      if (!row) throw apiProblem("not_found");
      await runApiOperation(updateFileOperation, call.principal, {
        id: row.id,
        version: match.version,
        category: patch.category ?? row.category,
        ...("caption" in patch ? (patch.caption ? { caption: patch.caption } : {}) : row.caption ? { caption: row.caption } : {}),
      });
      call.committed({ status: 200, body: { data: { id: row.id } } });
      const fresh = await getFile(call.principal, row.id);
      if (!fresh) throw apiProblem("not_found");
      return { status: 200, body: { data: toItem(fresh) }, headers: { etag: etagOf(fresh.version) } };
    },
  },
  {
    ...common,
    method: "DELETE",
    path: "/files/{id}",
    permission: "files.view",
    operationId: "files.delete",
    summary: "Remove a file (it is archived: gone from lists and delivery, the stored file stays untouched)",
    operations: [archiveFileOperation.name],
    status: 204,
    handler: async (call) => {
      if (!ID_SHAPE.test(call.params.id)) throw apiProblem("not_found");
      await runApiOperation(archiveFileOperation, call.principal, { id: call.params.id });
      return { status: 204 };
    },
  },
];
