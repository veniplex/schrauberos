import { createHash } from "node:crypto";
import { z } from "zod";
import { claimRow, versionOf } from "@/lib/concurrency";
import { pngPixelHash } from "@/lib/png-pixels";
import { parseSignatureValue } from "@/lib/signature";
import { orderRef } from "@/modules/workshop/orders/public";
import { db } from "@/server/db";
import { removeFile, storeFile } from "@/server/files";
import { defineOperation, fail, failField, OperationError, type Tx } from "@/server/operations";
import { ownerAccess, visibleChecklistsWhere } from "./access";
import { HINT_MAX, ITEM_TYPES, LABEL_MAX, MAX_ITEMS, MAX_OPEN_PER_OWNER, SIGNATURE_MODES } from "./constants";
import { installDefaultTemplates } from "./install";
import { checkAnswer, itemDefProblem, openRequired, sameItems, sameName, type ItemDef } from "./domain";

/**
 * Operationen der Checklisten.
 *  - **Vorlagen** (`checklists.manage`): Jede Änderung erzeugt eine **neue Version**; eine Speicherung ohne inhaltliche Änderung erzeugt keine. Begonnene und abgeschlossene Checklisten tragen ihre Punkte als Kopie.
 *  - **Beginnen** kopiert die aktuelle Version der Vorlage in eine Checkliste an Fahrzeug oder Auftrag.
 *  - **Punkte** werden einzeln gespeichert (Haken, Messwert, Drehmoment, Auswahl, Text); jeder Punkt hat seine eigene Version (gleichzeitiges Abhaken zweier Personen), Person und Zeit stehen am Punkt.
 *  - **Abschließen** verlangt alle Pflichtpunkte und – je nach Vorlage – die Kundenunterschrift (gezeichnet oder getippter Name wie bei der Freigabe in Aufträgen; ein Bild gilt für genau eine Checkliste).
 *    Danach ist die Checkliste **unveränderlich**; Wiederöffnen nur mit `checklists.reopen` und Begründung (Verlauf; die bisherige Unterschrift bleibt als Datei liegen, gilt aber nicht mehr).
 */

const byName = (principal: { user: { name: string } }): string => principal.user.name.slice(0, 80);

/* ───────────── Vorlagen ───────────── */

const optionalNumber = z.preprocess((value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    const text = value.trim().replace(",", ".");
    return text === "" ? null : Number(text);
  }
  return value;
}, z.number({ error: "validation.invalid" }).nullable());

/** Wahrheitswert aus Formular oder API: nur `true`, "true", "on" und "1" sind wahr – "false" und "0" sind es nicht (anders als `z.coerce.boolean()`). */
const boolField = z.preprocess((value) => value === true || value === "true" || value === "on" || value === "1", z.boolean());

const blankToNull = (value: string | null | undefined): string | null => (value && value.trim() !== "" ? value.trim() : null);

const templateItem = z.object({
  label: z.string().trim().min(1).max(LABEL_MAX),
  type: z.enum(ITEM_TYPES),
  unit: z.string().max(12).nullish().transform(blankToNull),
  minValue: optionalNumber.optional().transform((v) => v ?? null),
  maxValue: optionalNumber.optional().transform((v) => v ?? null),
  targetValue: optionalNumber.optional().transform((v) => v ?? null),
  options: z.string().max(2000).nullish().transform(blankToNull),
  required: z.boolean().default(true),
  hint: z.string().max(HINT_MAX).nullish().transform(blankToNull),
});

/** Die Punkte kommen als JSON-Text (versteckes Feld des Editors) oder als Liste (API). */
const itemsField = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}, z.array(templateItem).min(1).max(MAX_ITEMS));

export const saveTemplateInput = z.object({
  id: z.string().min(1).optional(),
  /** Stand der Vorlage beim Öffnen des Editors (gleichzeitiges Bearbeiten); beim Anlegen entfällt er */
  version: z.string().optional(),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  signatureMode: z.enum(SIGNATURE_MODES).default("none"),
  note: z.string().trim().max(300).optional(),
  items: itemsField,
});

const toDefs = (items: ReadonlyArray<z.output<typeof templateItem>>): ItemDef[] => items.map((i) => ({ label: i.label, type: i.type, unit: i.unit, minValue: i.minValue, maxValue: i.maxValue, targetValue: i.targetValue, options: i.options, required: i.required, hint: i.hint }));

/** Legt eine Vorlage an (Version 1) bzw. speichert eine **neue Version**; ohne inhaltliche Änderung bleibt es bei der bisherigen. */
export const saveTemplateOperation = defineOperation({
  name: "checklists.saveTemplate",
  permission: "checklists.manage",
  input: saveTemplateInput,
  audit: (input) => (input.id ? "checklist.templateUpdate" : "checklist.templateCreate"),
  run: async ({ input: d, principal, tx, audit }) => {
    const defs = toDefs(d.items);
    // alle Fehler der Punkte auf einmal melden (der Editor zeigt sie je Punkt)
    const problems: Record<string, { key: never }> = {};
    defs.forEach((def, i) => {
      const problem = itemDefProblem(def);
      if (problem) problems[`items.${i}.${problem.field}`] = { key: problem.key as never };
    });
    if (Object.keys(problems).length > 0) throw new OperationError({ code: "invalid", fields: problems });
    const data = { name: d.name, description: d.description || null, signatureMode: d.signatureMode };
    if (!d.id) {
      const template = await tx.checklistTemplate.create({ data: { name: d.name }, select: { id: true } });
      const version = await tx.checklistTemplateVersion.create({ data: { templateId: template.id, version: 1, ...data, note: d.note || null, createdByName: byName(principal) }, select: { id: true } });
      await tx.checklistTemplateItem.createMany({ data: defs.map((def, position) => ({ versionId: version.id, position, ...def })) });
      audit({ target: `${d.name} · v1`, entityId: template.id });
      return { id: template.id, version: 1, changed: true };
    }
    const template = await tx.checklistTemplate.findUnique({
      where: { id: d.id },
      select: { id: true, name: true, archivedAt: true, standardKey: true, versions: { orderBy: { version: "desc" }, take: 1, select: { id: true, version: true, name: true, description: true, signatureMode: true, items: { orderBy: { position: "asc" } } } } },
    });
    if (!template) fail("notFound");
    if (template.archivedAt) fail("invalid", "checklists.errors.templateArchived");
    if (!(await claimRow(tx.checklistTemplate, d.id, d.version))) fail("conflict");
    const latest = template.versions[0];
    const unchanged = latest && latest.name === data.name && (latest.description ?? null) === data.description && latest.signatureMode === data.signatureMode && sameItems(latest.items as unknown as ItemDef[], defs);
    if (unchanged) {
      audit({ target: `${d.name} · v${latest.version} (unchanged)`, entityId: template.id });
      return { id: template.id, version: latest.version, changed: false };
    }
    const next = (latest?.version ?? 0) + 1;
    const version = await tx.checklistTemplateVersion.create({ data: { templateId: template.id, version: next, ...data, note: d.note || null, createdByName: byName(principal) }, select: { id: true } });
    await tx.checklistTemplateItem.createMany({ data: defs.map((def, position) => ({ versionId: version.id, position, ...def })) });
    await tx.checklistTemplate.update({ where: { id: template.id }, data: { name: d.name } });
    audit({ target: `${d.name} · v${next}`, entityId: template.id });
    return { id: template.id, version: next, changed: true };
  },
});

export const archiveTemplateOperation = defineOperation({
  name: "checklists.archiveTemplate",
  permission: "checklists.manage",
  input: z.object({ id: z.string().min(1), archived: boolField }),
  audit: "checklist.templateArchive",
  run: async ({ input: d, tx, audit }) => {
    const template = await tx.checklistTemplate.findUnique({ where: { id: d.id }, select: { name: true } });
    if (!template) fail("notFound");
    await tx.checklistTemplate.update({ where: { id: d.id }, data: { archivedAt: d.archived ? new Date() : null } });
    audit({ target: `${template.name}: ${d.archived ? "archived" : "active"}`, entityId: d.id });
    return { id: d.id };
  },
});

export const installDefaultsOperation = defineOperation({
  name: "checklists.installDefaults",
  permission: "checklists.manage",
  input: z.object({}),
  audit: "checklist.templateCreate",
  run: async ({ principal, tx, audit }) => {
    const created = await installDefaultTemplates(tx, byName(principal));
    if (created === 0) fail("invalid", "checklists.errors.defaultsPresent");
    audit({ target: `${created}`, entityId: null });
    return { created };
  },
});

/* ───────────── Beginnen ───────────── */

const startInput = z.object({ templateId: z.string().min(1).max(64), vehicleId: z.string().max(64).optional(), orderId: z.string().max(64).optional() });

/** Beginnt eine Checkliste aus der aktuellen Version einer Vorlage – am Auftrag (das Fahrzeug ergibt sich daraus) oder am Fahrzeug. Die Punkte werden kopiert. */
export const startChecklistOperation = defineOperation({
  name: "checklists.start",
  permission: "checklists.fill",
  input: startInput,
  audit: "checklist.start",
  run: async ({ input: d, principal, tx, audit, emit }) => {
    const owner = await ownerAccess(principal, d, tx);
    const template = await tx.checklistTemplate.findUnique({
      where: { id: d.templateId },
      select: { id: true, name: true, standardKey: true, archivedAt: true, versions: { orderBy: { version: "desc" }, take: 1, select: { id: true, version: true, name: true, signatureMode: true, items: { orderBy: { position: "asc" } } } } },
    });
    if (!template) failField("templateId", "validation.invalid");
    if (template.archivedAt || template.versions.length === 0) failField("templateId", "checklists.errors.templateArchived");
    const version = template.versions[0];
    const open = await tx.checklist.count({ where: { status: "open", ...(owner.orderId ? { orderId: owner.orderId } : { vehicleId: owner.vehicleId, orderId: null }) } });
    if (open >= MAX_OPEN_PER_OWNER) fail("invalid", "checklists.errors.tooMany");
    const who = byName(principal);
    const created = await tx.checklist.create({
      data: {
        templateId: template.id,
        versionId: version.id,
        templateName: version.name,
        templateVersion: version.version,
        standardKey: template.standardKey,
        signatureMode: version.signatureMode,
        vehicleId: owner.vehicleId,
        orderId: owner.orderId,
        createdByName: who,
        createdById: principal.user.id,
        items: { create: version.items.map((item) => ({ position: item.position, label: item.label, type: item.type, unit: item.unit, minValue: item.minValue, maxValue: item.maxValue, targetValue: item.targetValue, options: item.options, required: item.required, hint: item.hint })) },
        events: { create: [{ kind: "created", byName: who }] },
      },
      select: { id: true },
    });
    await emit("checklist.started", { template: version.name, owner: owner.orderId ? "order" : "vehicle" }, created.id);
    audit({ target: `${version.name} · ${owner.label}`, entityId: created.id });
    return { id: created.id };
  },
});

/* ───────────── Punkte ───────────── */

export const setItemInput = z.object({
  id: z.string().min(1),
  /** Stand des Punktes beim Laden (jeder Punkt hat seine eigene Version) */
  version: z.string().min(1),
  done: boolField.optional(),
  numberValue: optionalNumber.optional(),
  textValue: z.string().max(4000).optional(),
});

/** Die Checkliste ist offen und – hängt sie an einem Auftrag – der Auftrag auch. */
async function assertEditable(tx: Tx, checklist: { status: string; orderId: string | null }): Promise<void> {
  if (checklist.status !== "open") fail("invalid", checklist.status === "completed" ? "checklists.errors.completed" : "checklists.errors.discarded");
  if (checklist.orderId) {
    const order = await orderRef(checklist.orderId, tx);
    if (!order?.open) fail("invalid", "checklists.errors.orderClosed");
  }
}

/**
 * Speichert das Ergebnis eines Punktes (Haken, Messwert, Drehmoment, Auswahl, Text). Der Punkt hat eine eigene Version: Haken zwei Personen gleichzeitig dieselbe Checkliste ab, gewinnt je Punkt genau eine Änderung,
 * die andere erfährt den Konflikt (`conflict`). Ein Messwert außerhalb der Grenzen wird gespeichert und markiert, nicht verhindert. Abgeschlossene Checklisten nehmen nichts mehr an.
 */
export const setItemOperation = defineOperation({
  name: "checklists.setItem",
  permission: "checklists.fill",
  input: setItemInput,
  audit: false,
  auditReason: "Einzelne Haken sind der Arbeitsstand einer offenen Checkliste (Person und Zeit stehen am Punkt); Beginn, Abschluss, Wiederöffnen und Verwerfen werden im Audit-Log protokolliert.",
  run: async ({ input: d, principal, tx }) => {
    const where = visibleChecklistsWhere(principal);
    if (!where) fail("forbidden");
    const item = await tx.checklistItem.findFirst({ where: { id: d.id, checklist: { is: where } }, include: { checklist: { select: { status: true, orderId: true } } } });
    if (!item) fail("notFound");
    await assertEditable(tx, item.checklist);
    // PATCH-Semantik: fehlt `done`, bleibt der Haken eines reinen Haken-Punkts (check/photo) unverändert (ein Wert ohne `done` hakt ihn nie ab oder zurück); Messwert, Auswahl und Text leiten `done` aus dem Wert ab
    const keepsDone = item.type === "check" || item.type === "photo";
    const checked = checkAnswer(item, { done: d.done ?? (keepsDone ? item.done : undefined), numberValue: d.numberValue ?? null, textValue: d.textValue ?? null });
    if (!checked.ok) failField(checked.field, checked.key as never);
    if (!(await claimRow(tx.checklistItem, d.id, d.version))) fail("conflict");
    const updated = await tx.checklistItem.update({
      where: { id: d.id },
      data: { done: checked.done, numberValue: checked.numberValue, textValue: checked.textValue, doneByName: checked.done ? byName(principal) : null, doneAt: checked.done ? new Date() : null },
      select: { updatedAt: true },
    });
    return { id: d.id, version: versionOf(updated), done: checked.done };
  },
});

/* ───────────── Abschließen ───────────── */

export const completeInput = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  /** Name des Kunden (bei der Unterschrift; getippt muss der Name der Unterschrift ihm entsprechen) */
  customerName: z.string().trim().max(80).optional(),
  /** gezeichnet (PNG-Data-URL) oder `typed:<Name>` (Namensweg) */
  signature: z.string().max(100_000).optional(),
  note: z.string().trim().max(1000).optional(),
});

type PreparedSignature = { kind: "none" } | { kind: "typed"; name: string } | { kind: "drawn"; path: string; hash: string };

/**
 * Schließt die Checkliste ab. Alle Pflichtpunkte müssen erledigt sein; verlangt die Vorlage eine Unterschrift, kommt sie vom Kunden am Touchscreen (PNG, in `prepare` als Datei abgelegt und bei Rollback wieder
 * entfernt) oder als getippter Name mit Bestätigung, der zum angegebenen Kundennamen passen muss. Dasselbe Bild gilt für genau eine Checkliste. Ab jetzt ist die Checkliste unveränderlich.
 */
export const completeChecklistOperation = defineOperation({
  name: "checklists.complete",
  permission: "checklists.fill",
  input: completeInput,
  audit: "checklist.complete",
  prepare: async ({ input: d, principal }): Promise<PreparedSignature> => {
    const where = visibleChecklistsWhere(principal);
    if (!where) fail("forbidden");
    const checklist = await db.checklist.findFirst({ where: { id: d.id, ...where }, select: { signatureMode: true } });
    if (!checklist) fail("notFound");
    if (!d.signature) {
      if (checklist.signatureMode === "required") failField("signature", "checklists.errors.signatureRequired");
      return { kind: "none" };
    }
    if (checklist.signatureMode === "none") failField("signature", "checklists.errors.signatureNotAllowed");
    const value = parseSignatureValue(d.signature);
    if (!value) failField("signature", "checklists.errors.signatureInvalid");
    if (!d.customerName) failField("customerName", "validation.required");
    if (value.kind === "typed") {
      if (!sameName(value.name, d.customerName)) failField("signature", "checklists.errors.nameMismatch");
      return { kind: "typed", name: value.name };
    }
    // Prüfsumme über die Bildpunkte (nicht über die Bytes): angehängte Teile oder andere Kompression ändern sie nicht
    const hash = pngPixelHash(value.png) ?? createHash("sha256").update(value.png).digest("hex");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return { kind: "drawn", hash, path: await storeFile("checklisten/unterschriften", `unterschrift-${stamp}.png`, value.png) };
  },
  run: async ({ input: d, principal, prepared, tx, audit, emit }) => {
    const where = visibleChecklistsWhere(principal);
    if (!where) fail("forbidden");
    const checklist = await tx.checklist.findFirst({ where: { id: d.id, ...where }, include: { items: { select: { required: true, done: true } }, vehicle: { select: { plate: true } }, order: { select: { number: true } } } });
    if (!checklist) fail("notFound");
    await assertEditable(tx, checklist);
    const open = openRequired(checklist.items);
    if (open.length > 0) fail("invalid", "checklists.errors.requiredOpen", { count: open.length });
    if (checklist.signatureMode === "required" && prepared.kind === "none") failField("signature", "checklists.errors.signatureRequired");
    // Ein Bild gilt für genau eine Checkliste
    // (auch gegen Unterschriften, die beim Wiederöffnen aufgehoben wurden – ausgenommen die Checkliste selbst)
    if (prepared.kind === "drawn") {
      const reused =
        (await tx.checklist.findFirst({ where: { signatureHash: prepared.hash, id: { not: d.id } }, select: { id: true } })) ?? (await tx.checklistEvent.findFirst({ where: { signatureHash: prepared.hash, checklistId: { not: d.id } }, select: { id: true } }));
      if (reused) failField("signature", "checklists.errors.signatureReused");
    }
    if (!(await claimRow(tx.checklist, d.id, d.version))) fail("conflict");
    const who = byName(principal);
    await tx.checklist.update({
      where: { id: d.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        completedByName: who,
        customerName: d.customerName || null,
        note: d.note || null,
        signaturePath: prepared.kind === "drawn" ? prepared.path : null,
        signatureHash: prepared.kind === "drawn" ? prepared.hash : null,
        signedName: prepared.kind === "typed" ? prepared.name : null,
      },
    });
    await tx.checklistEvent.create({ data: { checklistId: d.id, kind: "completed", byName: who, note: prepared.kind === "none" ? null : prepared.kind } });
    await emit("checklist.completed", { template: checklist.templateName, signed: prepared.kind !== "none" }, d.id);
    // Das Audit-Log nennt Vorlage, Fahrzeug bzw. Auftrag – nie den Namen des Kunden
    audit({ target: `${checklist.templateName} · ${checklist.order?.number ?? checklist.vehicle.plate}`, entityId: d.id });
    return { id: d.id };
  },
  finish: async (prepared, ok) => {
    if (!ok && prepared?.kind === "drawn") await removeFile(prepared.path).catch(() => undefined);
  },
});

/* ───────────── Wiederöffnen und Verwerfen ───────────── */

/**
 * Öffnet eine abgeschlossene Checkliste wieder (nur mit dem gekennzeichneten Recht `checklists.reopen`, Begründung Pflicht, Audit). Die bisherige Unterschrift gilt nicht mehr; ihre Datei bleibt liegen und steht im Verlauf,
 * ebenso ihre **Prüfsumme**: das Bild bleibt für jede andere Checkliste gesperrt (der Verlauf trägt sie, die Checkliste selbst nicht mehr).
 */
export const reopenChecklistOperation = defineOperation({
  name: "checklists.reopen",
  permission: "checklists.reopen",
  input: z.object({ id: z.string().min(1), version: z.string().min(1), reason: z.string().trim().min(5, { error: "checklists.errors.reasonRequired" }).max(300) }),
  audit: "checklist.reopen",
  run: async ({ input: d, principal, tx, audit }) => {
    const where = visibleChecklistsWhere(principal);
    if (!where) fail("forbidden");
    const checklist = await tx.checklist.findFirst({ where: { id: d.id, ...where }, include: { vehicle: { select: { plate: true } }, order: { select: { number: true } } } });
    if (!checklist) fail("notFound");
    if (checklist.status !== "completed") fail("invalid", "checklists.errors.notCompleted");
    if (checklist.orderId) {
      const order = await orderRef(checklist.orderId, tx);
      if (!order?.open) fail("invalid", "checklists.errors.orderClosed");
    }
    if (!(await claimRow(tx.checklist, d.id, d.version))) fail("conflict");
    await tx.checklist.update({ where: { id: d.id }, data: { status: "open", completedAt: null, completedByName: null, signaturePath: null, signatureHash: null, signedName: null } });
    await tx.checklistEvent.create({ data: { checklistId: d.id, kind: "reopened", byName: byName(principal), note: d.reason, signaturePath: checklist.signaturePath, signatureHash: checklist.signatureHash } });
    audit({ target: `${checklist.templateName} · ${checklist.order?.number ?? checklist.vehicle.plate}`, entityId: d.id });
    return { id: d.id };
  },
});

/** Verwirft eine offene Checkliste (falsch begonnen): sie bleibt mit Verlauf erhalten, erscheint aber nicht mehr als offen. Wer sie begonnen hat, oder die Leitung (`checklists.manage`). */
export const discardChecklistOperation = defineOperation({
  name: "checklists.discard",
  permission: "checklists.fill",
  input: z.object({ id: z.string().min(1), version: z.string().min(1) }),
  audit: "checklist.discard",
  run: async ({ input: d, principal, tx, audit }) => {
    const where = visibleChecklistsWhere(principal);
    if (!where) fail("forbidden");
    const checklist = await tx.checklist.findFirst({ where: { id: d.id, ...where }, include: { vehicle: { select: { plate: true } }, order: { select: { number: true } } } });
    if (!checklist) fail("notFound");
    if (checklist.status !== "open") fail("invalid", "checklists.errors.notOpen");
    if (checklist.createdById !== principal.user.id && !principal.can("checklists.manage")) fail("forbidden");
    if (!(await claimRow(tx.checklist, d.id, d.version))) fail("conflict");
    await tx.checklist.update({ where: { id: d.id }, data: { status: "discarded" } });
    await tx.checklistEvent.create({ data: { checklistId: d.id, kind: "discarded", byName: byName(principal) } });
    audit({ target: `${checklist.templateName} · ${checklist.order?.number ?? checklist.vehicle.plate}`, entityId: d.id });
    return { id: d.id };
  },
});
