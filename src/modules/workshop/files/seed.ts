import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { normalizePlate } from "@/lib/plate";
import type { SeedDef } from "@/modules/types";
import { storeFile } from "@/server/files";
import { demoPdf, demoPng } from "./demo-image";

/**
 * Demo-Dateien: Fotos und ein PDF am Auftrag „in Arbeit“ und an einem Demo-Fahrzeug (gefunden über Status bzw. Kennzeichen; fehlt es, entfallen die Dateien). Die Dateien sind echte, kleine Bilder und
 * liegen wie im Betrieb unter `/data/files`. Ein Foto ist entfernt (archiviert), damit auch dieser Zustand sichtbar ist.
 */
async function demo(db: PrismaClient) {
  if ((await db.fileAttachment.count()) > 0) return;
  const order = await db.order.findFirst({ where: { status: "in_progress" }, orderBy: { acceptedAt: "asc" }, select: { id: true, number: true, vehicleId: true } });
  const vehicle = (await db.vehicle.findFirst({ where: { plateNorm: normalizePlate("B-AB 1234") }, select: { id: true, plateNorm: true } })) ?? (order ? await db.vehicle.findUnique({ where: { id: order.vehicleId }, select: { id: true, plateNorm: true } }) : null);
  if (!order && !vehicle) return;
  console.log("Demo-Daten (Dokumente & Fotos) werden angelegt …");

  const add = async (owner: { vehicleId?: string; orderId?: string }, dir: string, name: string, bytes: Buffer, mime: string, extra: { category: string; caption?: string; width?: number; height?: number; archived?: boolean }) => {
    const path = await storeFile(dir, name, bytes);
    await db.fileAttachment.create({
      data: {
        ...owner,
        category: extra.category,
        caption: extra.caption ?? null,
        name,
        mime,
        size: bytes.length,
        width: extra.width ?? null,
        height: extra.height ?? null,
        path,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        uploadedById: "demo",
        uploadedByName: "Demo",
        ...(extra.archived ? { archivedAt: new Date(), archivedByName: "Demo" } : {}),
      },
    });
  };

  if (order) {
    const dir = `auftraege/${order.number}`;
    await add({ orderId: order.id }, dir, "annahme-front.png", demoPng(160, 100, [58, 94, 160]), "image/png", { category: "intake", caption: "Annahme: Front, kleiner Kratzer links", width: 160, height: 100 });
    await add({ orderId: order.id }, dir, "bremse-vorn.png", demoPng(160, 100, [120, 120, 126]), "image/png", { category: "work", caption: "Bremsscheibe vorn links, Verschleiß", width: 160, height: 100 });
    await add({ orderId: order.id }, dir, "versehen.png", demoPng(120, 80, [200, 90, 60]), "image/png", { category: "photo", caption: "Falsches Foto (entfernt)", width: 120, height: 80, archived: true });
    await add({ orderId: order.id }, dir, "kostenvoranschlag.pdf", demoPdf("Kostenvoranschlag Bremsen"), "application/pdf", { category: "document", caption: "Kostenvoranschlag" });
  }
  if (vehicle) {
    const dir = `fahrzeuge/${vehicle.plateNorm}`;
    await add({ vehicleId: vehicle.id }, dir, "fahrzeugschein.pdf", demoPdf("Fahrzeugschein (Kopie)"), "application/pdf", { category: "document", caption: "Zulassungsbescheinigung, Kopie" });
    await add({ vehicleId: vehicle.id }, dir, "lack-rechts.png", demoPng(160, 100, [80, 140, 90]), "image/png", { category: "damage", caption: "Parkschaden rechts hinten", width: 160, height: 100 });
  }
}

export const seeds: SeedDef[] = [{ id: "files", feature: "workshop.files", order: 70, demo }];
