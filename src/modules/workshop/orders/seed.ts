import type { PrismaClient } from "@/generated/prisma/client";
import { currentYear } from "@/lib/dates";
import { normalizePlate } from "@/lib/plate";
import { addDays } from "@/lib/zone";
import type { SeedDef } from "@/modules/types";
import { nextCounterValue } from "@/server/counters";
import { ORDER_COUNTER } from "./constants";
import { formatOrderNumber } from "./domain";

type Line = { kind: "labor" | "part" | "other"; description: string; unit: string; qty: number; unitCents: number; taxBp?: number; discountBp?: number };

/**
 * Demo-Aufträge in jedem Status an den Demo-Fahrzeugen (gefunden über das Kennzeichen; fehlt eines, entfällt der Auftrag). Die Nummern kommen aus dem Zähler wie im Betrieb,
 * damit der nächste echte Auftrag nahtlos weiterzählt. Ein Auftrag trägt ein Freigabe-Protokoll (telefonisch), einer ist abgeschlossen, einer storniert.
 */
async function demo(db: PrismaClient) {
  if ((await db.order.count()) > 0) return;
  console.log("Demo-Daten (Aufträge) werden angelegt …");

  const orders: Array<{
    plate: string;
    status: "accepted" | "in_progress" | "ready" | "picked_up" | "cancelled";
    daysAgo: number;
    request: string;
    mileageKm?: number;
    findings?: string[];
    lines?: Line[];
    approval?: { cents: number; reason: string; name: string };
  }> = [
    { plate: "B-AN 100", status: "accepted", daysAgo: 0, request: "Ölwechsel und Sichtprüfung vor der Urlaubsfahrt.", mileageKm: 87_450 },
    {
      plate: "B-AB 1234",
      status: "in_progress",
      daysAgo: 1,
      request: "Inspektion nach Herstellervorgabe, Bremsen quietschen vorn.",
      mileageKm: 61_200,
      findings: ["Bremsbeläge vorn bei 2 mm, Scheiben noch in Ordnung."],
      lines: [
        { kind: "labor", description: "Inspektion klein", unit: "Std.", qty: 1.5, unitCents: 8500 },
        { kind: "labor", description: "Bremsbeläge vorn wechseln", unit: "Std.", qty: 1, unitCents: 8500 },
        { kind: "other", description: "Entsorgung Altteile", unit: "", qty: 1, unitCents: 500 },
      ],
    },
    {
      plate: "B-EY 2020",
      status: "ready",
      daysAgo: 3,
      request: "Klimaanlage kühlt nicht mehr.",
      mileageKm: 42_000,
      findings: ["Klimakompressor zieht Strom, Kältemittel fast leer – Leck am Kondensator."],
      lines: [
        { kind: "labor", description: "Klimaservice mit Dichtheitsprüfung", unit: "Std.", qty: 1, unitCents: 8500 },
        { kind: "part", description: "Kondensator Klimaanlage", unit: "Stk", qty: 1, unitCents: 18900 },
        { kind: "labor", description: "Kondensator ersetzen", unit: "Std.", qty: 1.5, unitCents: 8500 },
      ],
      approval: { cents: 24_000, reason: "Kondensator ersetzen (Leck gefunden), Mehrarbeit über den Kostenvoranschlag.", name: "Erika Beispiel" },
    },
    {
      plate: "B-MS 815",
      status: "picked_up",
      daysAgo: 12,
      request: "Winterräder montieren und wuchten.",
      mileageKm: 133_800,
      lines: [
        { kind: "labor", description: "Räder wechseln und wuchten", unit: "Std.", qty: 0.75, unitCents: 8500 },
        { kind: "labor", description: "Reifendruck kontrollieren", unit: "", qty: 1, unitCents: 0 },
      ],
    },
    { plate: "B-SN 909", status: "cancelled", daysAgo: 20, request: "Kostenvoranschlag Fahrwerk.", mileageKm: 98_100 },
  ];

  const year = currentYear();
  for (const o of orders) {
    const vehicle = await db.vehicle.findFirst({ where: { plateNorm: normalizePlate(o.plate) }, select: { id: true, customerId: true, mileageKm: true } });
    if (!vehicle) continue;
    const acceptedAt = addDays(new Date(), -o.daysAgo);
    const number = formatOrderNumber(year, await nextCounterValue(db, ORDER_COUNTER, year));
    const order = await db.order.create({
      data: {
        number,
        status: o.status,
        vehicleId: vehicle.id,
        customerId: vehicle.customerId,
        request: o.request,
        mileageKm: o.mileageKm ?? null,
        acceptedAt,
        closedAt: o.status === "picked_up" ? new Date(acceptedAt.getTime() + 4 * 3_600_000) : null,
        createdByName: "Demo",
        items: o.lines
          ? { create: o.lines.map((l, position) => ({ position, kind: l.kind, description: l.description, unit: l.unit, quantityMilli: Math.round(l.qty * 1000), unitCents: l.unitCents, taxBp: l.taxBp ?? 1900, discountBp: l.discountBp ?? 0 })) }
          : undefined,
        findings: o.findings ? { create: o.findings.map((text) => ({ text, authorName: "Demo" })) } : undefined,
        approvals: o.approval ? { create: [{ amountCents: o.approval.cents, reason: o.approval.reason, method: "phone", approverName: o.approval.name, recordedByName: "Demo" }] } : undefined,
      },
      select: { id: true },
    });
    const events: Array<{ kind: string; status: string | null; at: Date }> = [{ kind: "created", status: null, at: acceptedAt }];
    const chain = ["accepted", "in_progress", "ready", "picked_up"];
    if (o.status === "cancelled") events.push({ kind: "status", status: "cancelled", at: new Date(acceptedAt.getTime() + 3_600_000) });
    else chain.slice(1, chain.indexOf(o.status) + 1).forEach((status, i) => events.push({ kind: "status", status, at: new Date(acceptedAt.getTime() + (i + 1) * 3_600_000) }));
    if (o.approval) events.push({ kind: "approval", status: null, at: new Date(acceptedAt.getTime() + 2 * 3_600_000) });
    await db.orderEvent.createMany({ data: events.map((e) => ({ orderId: order.id, kind: e.kind, status: e.status, byName: "Demo", note: e.kind === "approval" ? o.approval?.name : null, at: e.at })) });
  }
}

export const seeds: SeedDef[] = [{ id: "orders", feature: "workshop.orders", order: 60, demo }];
