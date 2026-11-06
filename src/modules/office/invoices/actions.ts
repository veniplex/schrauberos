"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/session";
import { getI18n } from "@/i18n/server";
import type { ActionState } from "@/components/ui/form";
import { fieldErrors, formObject } from "@/lib/forms";
import { INVOICE_DIRECTIONS, INVOICE_FILE_MAX_BYTES, INVOICE_FILE_TYPES, INVOICE_STATUSES, amountsConsistent, invoiceFileLocation } from "@/modules/office/invoices/domain";
import { parseMoneyToCents } from "@/lib/money";
import { audit } from "@/server/audit";
import { claimed } from "@/lib/concurrency";
import { storeFile } from "@/server/files";
import { removeInvoiceFile, syncInvoiceFile } from "./files";

function refresh(id?: string) {
  for (const p of ["/invoices", "/"]) revalidatePath(p);
  if (id) revalidatePath(`/invoices/${id}`);
}

const dateOpt = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const noon = (d: string) => new Date(`${d}T12:00:00`);

const schema = z.object({
  id: z.string().optional(),
  version: z.string().optional(),
  direction: z.enum(INVOICE_DIRECTIONS),
  number: z.string().trim().min(1).max(60),
  partyName: z.string().trim().min(1).max(120),
  customerId: z.string().optional(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: dateOpt,
  net: z.string().max(20).optional(),
  vat: z.string().max(20).optional(),
  gross: z.string().max(20),
  status: z.enum(INVOICE_STATUSES).default("open"),
  paidAt: dateOpt,
  category: z.string().max(60).optional(),
  reference: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
});

export async function saveInvoice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("invoices.edit");
  const { t } = await getI18n();
  const parsed = schema.safeParse(formObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error, t) };
  const d = parsed.data;

  // Beträge
  const errors: Record<string, string> = {};
  const money = (value: string | undefined, key: string) => {
    if (!value) return null;
    const cents = parseMoneyToCents(value);
    if (cents === null) errors[key] = t("invoices.errors.amount");
    return cents;
  };
  const grossCents = money(d.gross, "gross");
  const netCents = money(d.net, "net");
  const vatCents = money(d.vat, "vat");
  if (grossCents === 0) errors.gross = t("invoices.errors.amount");
  if (Object.keys(errors).length) return { fieldErrors: errors };
  if (!amountsConsistent(netCents, vatCents, grossCents!)) return { fieldErrors: { gross: t("invoices.errors.sumMismatch") } };

  if (d.dueDate && d.dueDate < d.issueDate) return { fieldErrors: { dueDate: t("invoices.errors.dueBeforeIssue") } };

  // Dopplung: gleiche Nummer beim selben Geschäftspartner
  const dup = await db.invoice.findFirst({
    where: { direction: d.direction, number: d.number, partyName: d.partyName, ...(d.id ? { id: { not: d.id } } : {}) },
  });
  if (dup) return { fieldErrors: { number: t("invoices.errors.duplicate") } };

  if (d.customerId && !(await db.customer.findUnique({ where: { id: d.customerId }, select: { id: true } }))) {
    return { fieldErrors: { customerId: t("validation.invalid") } };
  }

  // Datei
  const file = formData.get("file");
  let upload: { name: string; mime: string; size: number; data: Uint8Array<ArrayBuffer> } | null = null;
  if (file instanceof File && file.size > 0) {
    if (!(INVOICE_FILE_TYPES as readonly string[]).includes(file.type)) return { fieldErrors: { file: t("invoices.errors.fileType") } };
    if (file.size > INVOICE_FILE_MAX_BYTES) return { fieldErrors: { file: t("invoices.errors.fileSize") } };
    upload = { name: file.name.slice(0, 120), mime: file.type, size: file.size, data: new Uint8Array(await file.arrayBuffer()) };
  }

  const status = d.status;
  const data = {
    direction: d.direction,
    number: d.number,
    partyName: d.partyName,
    customerId: d.direction === "outgoing" ? (d.customerId ?? null) : null,
    issueDate: noon(d.issueDate),
    dueDate: d.dueDate ? noon(d.dueDate) : null,
    netCents,
    vatCents,
    grossCents: grossCents!,
    status,
    paidAt: status === "paid" ? noon(d.paidAt ?? d.issueDate) : null,
    category: d.category ?? null,
    reference: d.reference ?? null,
    notes: d.notes ?? null,
  };

  // Der Beleg kommt als normale Datei in den Dateispeicher (lesbarer Pfad), in der Datenbank steht nur der Pfad.
  const location = upload ? invoiceFileLocation({ direction: d.direction, issueDate: data.issueDate, number: d.number, partyName: d.partyName }, upload.mime) : null;
  const stored = upload && location ? await storeFile(location.dir, location.name, upload.data) : null;
  let replacedPath: string | null = null;
  let id: string | null;
  try {
    id = await db.$transaction(async (tx) => {
      if (d.id && !(await claimed(d.version, (stamp, next) => tx.invoice.updateMany({ where: { id: d.id, updatedAt: stamp }, data: { updatedAt: next } })))) return null;
      const saved = d.id ? await tx.invoice.update({ where: { id: d.id }, data }) : await tx.invoice.create({ data });
      const existing = await tx.invoiceFile.findUnique({ where: { invoiceId: saved.id } });
      if (formData.get("removeFile") === "on" && !upload && existing) {
        await tx.invoiceFile.delete({ where: { invoiceId: saved.id } });
        replacedPath = existing.path;
      }
      if (upload && stored) {
        await tx.invoiceFile.upsert({
          where: { invoiceId: saved.id },
          update: { name: upload.name, mime: upload.mime, size: upload.size, path: stored, uploadedAt: new Date() },
          create: { invoiceId: saved.id, name: upload.name, mime: upload.mime, size: upload.size, path: stored },
        });
        replacedPath = existing?.path ?? null;
      }
      return saved.id;
    });
  } catch (error) {
    if (stored) await removeInvoiceFile(stored).catch(() => undefined);
    throw error;
  }
  if (!id) {
    if (stored) await removeInvoiceFile(stored).catch(() => undefined);
    return { error: t("common.conflict") };
  }
  if (replacedPath) await removeInvoiceFile(replacedPath).catch((e) => console.error("[invoices] Alter Beleg konnte nicht gelöscht werden:", e));
  await syncInvoiceFile(id).catch((e) => console.error("[invoices] Beleg konnte nicht umbenannt werden:", e));
  refresh(id);
  redirect(`/invoices/${id}`);
}

/** Schnellaktion: als bezahlt markieren (Datum optional, Standard heute). */
export async function markInvoicePaid(formData: FormData) {
  await requirePermission("invoices.edit");
  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("paidAt") ?? "");
  const paidAt = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? noon(raw) : new Date();
  if (id) await db.invoice.update({ where: { id }, data: { status: "paid", paidAt } });
  refresh(id);
}

export async function reopenInvoice(formData: FormData) {
  await requirePermission("invoices.edit");
  const id = String(formData.get("id") ?? "");
  if (id) await db.invoice.update({ where: { id }, data: { status: "open", paidAt: null } });
  refresh(id);
}

export async function deleteInvoice(formData: FormData) {
  await requirePermission("invoices.delete");
  const id = String(formData.get("id") ?? "");
  const inv = id ? await db.invoice.findUnique({ where: { id }, select: { direction: true, number: true, file: { select: { path: true } } } }) : null;
  if (id) await db.invoice.deleteMany({ where: { id } });
  if (inv?.file) await removeInvoiceFile(inv.file.path).catch((e) => console.error("[invoices] Beleg konnte nicht gelöscht werden:", e));
  if (inv) await audit("invoice.delete", { target: inv.number, entityId: id });
  refresh();
  redirect(`/invoices?dir=${inv?.direction ?? "incoming"}`);
}
