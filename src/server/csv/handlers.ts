import "server-only";
import { createHash } from "node:crypto";
import { contentDisposition } from "@/lib/file-delivery";
import { logError } from "@/lib/log-safe";
import { QueueFullError, Semaphore } from "@/lib/semaphore";
import { getI18n } from "@/i18n/server";
import type { MessageKey } from "@/i18n/translate";
import { audit } from "@/server/audit";
import { isBehindProxy } from "@/server/auth/network";
import { getSession, type AppSession } from "@/server/auth/session";
import type { ErrorCode } from "@/server/operations";
import { isSameOriginUpload } from "@/server/request-guard";
import { fileErrorKey, fileErrorParams } from "./define-import";
import { CSV_FORMATS, defaultFormatId, isCsvFormatId } from "./format";
import { CSV_LIMITS } from "./limits";
import { CsvError } from "./reader";
import { readTable } from "./table";
import type { ExportDef, ImportDef, PreviewResponse, PreviewRow } from "./types";
import { csvChunks } from "./writer";

/**
 * Die beiden Routen des Datenaustauschs (`/api/exchange/<art>` für den Export, `/api/exchange/<art>/import` für den Import). Die Routen unter `src/app/api/exchange` sind dünn
 * und reichen nur die Liste der Funktionen (`src/modules/exchange.ts`) herein – dieser Teil der Plattform kennt keine einzelne Funktion.
 *
 * Schutz (wie die übrigen Upload-Routen, `src/server/request-guard.ts`): Sitzung (kein Passwortwechsel offen), gleiche Herkunft und eigener Header `X-Requested-With`
 * (auch beim Export: ein fremder Link darf keinen Export auslösen), Funktion aktiv, Recht, Längenangabe **vor** dem Lesen des Bodys und Größenlimit. Die Datei liegt nie auf der Platte.
 */

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });

const STATUS: Record<ErrorCode, number> = { invalid: 422, unauthenticated: 401, forbidden: 403, notFound: 404, conflict: 409, duplicate: 409, inUse: 409, busy: 503, failed: 500 };

/** Anmeldung und Herkunft – gemeinsam für Export und Import; liefert die Sitzung oder die fertige Absage. */
async function authenticate(request: Request): Promise<AppSession | Response> {
  const session = await getSession();
  if (!session || session.user.mustChangePassword || session.user.mustSetupTwoFactor) return json({ error: "unauthorized" }, 401);
  if (!isSameOriginUpload(request, await isBehindProxy())) return json({ error: "forbidden" }, 403);
  return session;
}

/** Höchstens zwei Dateien zugleich lesen, auswerten und anlegen; weitere warten kurz, darüber „später noch einmal“ (Schutz des Arbeitsspeichers und des einen Schreibers). */
const importLane = new Semaphore(2, 2);

/* ───────────── Export ───────────── */

export async function handleExport(request: Request, kind: string | undefined, defs: readonly ExportDef[]): Promise<Response> {
  const session = await authenticate(request);
  if (session instanceof Response) return session;
  const def = defs.find((d) => d.id === kind);
  if (!def || !session.features.has(def.feature)) return json({ error: "notFound" }, 404);
  if (![def.permission, ...def.also].every((p) => session.can(p))) return json({ error: "forbidden" }, 403);

  const { t, locale } = await getI18n();
  const query = new URL(request.url).searchParams;
  const formatParam = query.get("format");
  const format = CSV_FORMATS[isCsvFormatId(formatParam) ? formatParam : defaultFormatId(locale)];

  const opened = await def.open({ session, query, format, t });
  if ("error" in opened) return json({ error: "invalid", message: t(opened.error) }, 422);
  if (opened.count > CSV_LIMITS.exportRows) return json({ error: "tooMany", message: t("exchange.errors.exportTooMany", { count: opened.count, max: CSV_LIMITS.exportRows }) }, 413);

  // Das Audit-Log hält fest, wer wie viele Zeilen mitgenommen hat – vor der ersten Ausgabe, damit auch ein abgebrochener Download eine Spur hat
  await audit(def.audit, { target: `${opened.count} Zeilen${opened.target ? ` · ${opened.target}` : ""}`, actor: { id: session.user.id, name: session.user.name } });

  const header = opened.columns.map((c) => t(c.labelKey));
  const encoder = new TextEncoder();
  const chunks = csvChunks(header, opened.rows, format, { bom: query.get("bom") !== "0" });
  async function* encoded() {
    try {
      for await (const chunk of chunks) yield encoder.encode(chunk);
    } catch (error) {
      logError("exchange:export", error);
      throw error;
    }
  }
  return new Response(toStream(encoded()), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": contentDisposition("attachment", def.filename(query)),
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}

/** Asynchroner Iterator → Antwortstrom (Rückdruck: es wird erst gelesen, wenn der Empfänger abholt). */
function toStream(source: AsyncGenerator<Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await source.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await source.return(undefined);
    },
  });
}

/* ───────────── Import ───────────── */

/** Mehr als die Datei selbst darf der Body nicht haben (Formularfelder, Ränder): größere Anfragen werden gar nicht erst gelesen. */
const BODY_OVERHEAD = 64 * 1024;
/** Von den Zeilen zeigt die Vorschau alle mit Problem (bis zu dieser Zahl) und einige Beispiele der neuen. */
const PREVIEW_PROBLEMS = 200;
const PREVIEW_SAMPLES = 8;

export async function handleImport(request: Request, kind: string | undefined, defs: readonly ImportDef[]): Promise<Response> {
  const session = await authenticate(request);
  if (session instanceof Response) return session;
  const def = defs.find((d) => d.id === kind);
  if (!def || !session.features.has(def.feature)) return json({ error: "notFound" }, 404);
  if (!session.can(def.permission)) return json({ error: "forbidden" }, 403);

  const { t } = await getI18n();
  const header = request.headers.get("content-length");
  const announced = header === null || header.trim() === "" ? Number.NaN : Number(header);
  if (!Number.isInteger(announced) || announced < 0) return json({ error: "lengthRequired", message: t("exchange.errors.lengthRequired") }, 411);
  if (announced > CSV_LIMITS.importBytes + BODY_OVERHEAD) return json({ error: "tooLarge", message: t(fileErrorKey("tooLarge"), fileErrorParams()) }, 413);

  try {
    return await importLane.run(() => runImport(request, session, def), { bounded: true });
  } catch (error) {
    if (error instanceof QueueFullError) return json({ error: "busy", message: t("common.errors.busy") }, 429);
    logError("exchange:import", error);
    return json({ error: "failed", message: t("common.errors.failed") }, 500);
  }
}

async function runImport(request: Request, session: AppSession, def: ImportDef): Promise<Response> {
  const { t } = await getI18n();
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const mode = String(form?.get("mode") ?? "");
  if (!(file instanceof File) || (mode !== "preview" && mode !== "apply")) return json({ error: "invalid", message: t("validation.invalid") }, 400);
  if (file.size === 0) return json({ error: "empty", message: t(fileErrorKey("empty"), fileErrorParams()) }, 422);
  if (file.size > CSV_LIMITS.importBytes) return json({ error: "tooLarge", message: t(fileErrorKey("tooLarge"), fileErrorParams()) }, 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  const allowDuplicates = def.duplicateOverride && form?.get("allowDuplicates") === "1";
  const skipErrors = form?.get("skipErrors") === "1";

  if (mode === "apply") {
    // Die Anwendung gilt genau der Datei, die die Vorschau gezeigt hat (das Feld könnte zwischen den Schritten eine andere Datei erhalten haben)
    if (form?.get("digest") !== digest) return json({ error: "changed", message: t("exchange.errors.fileChanged") }, 409);
    const outcome = await def.operation.execute(session, { bytes, allowDuplicates, skipErrors });
    if (!outcome.ok) {
      const { failure } = outcome;
      const key = (failure.key ?? (failure.code === "forbidden" ? "common.errors.forbidden" : "validation.invalid")) as MessageKey;
      return json({ error: failure.code, message: t(key, failure.params) }, STATUS[failure.code] ?? 500);
    }
    return json({ mode: "apply", ...outcome.data });
  }

  let table;
  try {
    table = readTable(bytes, def.columns(session));
  } catch (error) {
    if (error instanceof CsvError) return json({ error: error.code, message: t(fileErrorKey(error.code), fileErrorParams(error.line)) }, 422);
    throw error;
  }
  const plan = await def.preview(session, table, { allowDuplicates });
  const specs = def.columns(session);
  const label = (key: string) => {
    const spec = specs.find((c) => c.key === key);
    return spec ? t(spec.labelKey) : key;
  };
  const toRow = (row: (typeof plan.rows)[number]): PreviewRow => ({
    line: row.line,
    status: row.status,
    label: row.label,
    messages: row.messages.map((m) => (m.column ? `${label(m.column)}: ${t(m.key, m.params)}` : t(m.key, m.params))),
    forced: !!row.forced,
  });
  const problems = plan.rows.filter((r) => r.status !== "create" || r.forced);
  const samples = plan.rows.filter((r) => r.status === "create" && !r.forced).slice(0, PREVIEW_SAMPLES);
  const shown = problems.slice(0, PREVIEW_PROBLEMS);
  const body: PreviewResponse = {
    mode: "preview",
    digest,
    encoding: plan.table.encoding,
    delimiter: plan.table.delimiter,
    columns: plan.table.headers.map((h) => ({
      header: h.header,
      label: h.key ? label(h.key) : null,
      note: h.reason === "duplicate" ? t("exchange.columnNote.duplicate") : h.reason === "unknown" ? t("exchange.columnNote.unknown") : null,
    })),
    missing: plan.table.missing.map(label),
    counts: plan.counts,
    formulaLike: plan.table.formulaLike,
    rows: [...shown, ...samples].map(toRow).sort((a, b) => a.line - b.line),
    truncated: problems.length > shown.length,
    canApply: plan.table.missing.length === 0 && plan.counts.create > 0,
  };
  return json(body);
}
