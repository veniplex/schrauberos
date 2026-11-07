import type { PrismaClient } from "@/generated/prisma/client";
import { addDays } from "@/lib/zone";
import type { SeedDef } from "@/modules/types";
import { installDefaultTemplates } from "./install";

/**
 * Grunddaten (frische Installation): die mitgelieferten Vorlagen (Annahmeprotokoll, Ölwechsel, Reifenwechsel, HU-Vorbereitung); die Leitung passt sie an.
 * Demo: Checklisten in allen Zuständen – ein offenes Annahmeprotokoll am Auftrag „in Arbeit“, ein abgeschlossenes mit getipptem Namen, ein abgeschlossener Reifenwechsel mit Drehmoment (ein Wert
 * außerhalb der Grenzen), ein verworfenes und eine offene Checkliste am Fahrzeug.
 */
async function base(db: PrismaClient) {
  if ((await db.checklistTemplate.count()) > 0) return;
  await installDefaultTemplates(db, "System");
}

type Fill = { numbers?: Record<string, number>; texts?: Record<string, string>; checks?: boolean };

async function demo(db: PrismaClient) {
  if ((await db.checklist.count()) > 0) return;
  await installDefaultTemplates(db, "System");
  const templates = await db.checklistTemplate.findMany({ where: { standardKey: { not: null } }, select: { id: true, standardKey: true, versions: { orderBy: { version: "desc" }, take: 1, select: { id: true, version: true, name: true, signatureMode: true, items: { orderBy: { position: "asc" } } } } } });
  const template = (key: string) => templates.find((t) => t.standardKey === key);
  const orders = await db.order.findMany({ orderBy: { acceptedAt: "asc" }, select: { id: true, number: true, status: true, vehicleId: true } });
  const inProgress = orders.find((o) => o.status === "in_progress") ?? orders[0];
  const done = orders.find((o) => o.status === "picked_up") ?? orders[1];
  const vehicle = await db.vehicle.findFirst({ where: { archivedAt: null }, orderBy: { plateNorm: "asc" }, select: { id: true } });
  if (!inProgress && !vehicle) return;
  console.log("Demo-Daten (Checklisten) werden angelegt …");

  const create = async (key: string, owner: { vehicleId: string; orderId?: string }, status: "open" | "completed" | "discarded", fill: Fill & { partial?: boolean; signed?: string; customerName?: string; daysAgo?: number }) => {
    const tpl = template(key);
    const version = tpl?.versions[0];
    if (!tpl || !version) return;
    const when = addDays(new Date(), -(fill.daysAgo ?? 0));
    const checklist = await db.checklist.create({
      data: {
        templateId: tpl.id,
        versionId: version.id,
        templateName: version.name,
        templateVersion: version.version,
        standardKey: key,
        signatureMode: version.signatureMode,
        vehicleId: owner.vehicleId,
        orderId: owner.orderId ?? null,
        status,
        createdByName: "Demo",
        createdAt: when,
        ...(status === "completed" ? { completedAt: when, completedByName: "Demo", customerName: fill.customerName ?? null, signedName: fill.signed ?? null } : {}),
        items: {
          create: version.items.map((item, index) => {
            const filled = status === "completed" || (fill.partial ? index < Math.ceil(version.items.length / 2) : false);
            const number = fill.numbers?.[item.label];
            const text = fill.texts?.[item.label];
            const choice = item.type === "choice" ? item.options?.split("\n")[0] : null;
            return {
              position: item.position,
              label: item.label,
              type: item.type,
              unit: item.unit,
              minValue: item.minValue,
              maxValue: item.maxValue,
              targetValue: item.targetValue,
              options: item.options,
              required: item.required,
              hint: item.hint,
              done: filled || number !== undefined || text !== undefined,
              numberValue: number ?? (filled && (item.type === "measure" || item.type === "torque") ? (item.targetValue ?? item.minValue ?? 1) : null),
              textValue: text ?? (filled && item.type === "choice" ? choice : filled && item.type === "text" && item.required ? "In Ordnung" : null),
              doneByName: filled ? "Demo" : null,
              doneAt: filled ? when : null,
            };
          }),
        },
        events: { create: [{ kind: "created", byName: "Demo", at: when }, ...(status === "completed" ? [{ kind: "completed", byName: "Demo", at: when, note: fill.signed ? "typed" : null }] : []), ...(status === "discarded" ? [{ kind: "discarded", byName: "Demo", at: when }] : [])] },
      },
    });
    return checklist;
  };

  if (inProgress) {
    await create("intake", { vehicleId: inProgress.vehicleId, orderId: inProgress.id }, "open", { partial: true, daysAgo: 0 });
  }
  if (done) {
    await create("intake", { vehicleId: done.vehicleId, orderId: done.id }, "completed", { customerName: "Erika Beispiel", signed: "Erika Beispiel", daysAgo: 12 });
    await create("tires", { vehicleId: done.vehicleId, orderId: done.id }, "completed", { numbers: { "Anzugsdrehmoment Radschrauben/-muttern": 95 }, daysAgo: 12 });
  }
  if (vehicle) {
    await create("hu", { vehicleId: vehicle.id }, "open", { partial: true, daysAgo: 2 });
    await create("oil", { vehicleId: vehicle.id }, "discarded", { daysAgo: 6 });
  }
}

export const seeds: SeedDef[] = [{ id: "checklists", feature: "workshop.checklists", order: 75, base, demo }];
