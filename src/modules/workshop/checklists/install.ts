import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { DEFAULT_TEMPLATES } from "./defaults";

type Client = PrismaClient | Prisma.TransactionClient;

/**
 * Legt die mitgelieferten Vorlagen an, die es (nach `standardKey`) noch nicht gibt; bestehende – auch angepasste – bleiben unberührt. Ohne `server-only`-Importe, damit auch das Seed-Skript es benutzen kann.
 * Liefert die Zahl der neu angelegten Vorlagen.
 */
export async function installDefaultTemplates(db: Client, createdByName: string): Promise<number> {
  let created = 0;
  for (const def of DEFAULT_TEMPLATES) {
    if (await db.checklistTemplate.findUnique({ where: { standardKey: def.key }, select: { id: true } })) continue;
    const template = await db.checklistTemplate.create({ data: { name: def.name, standardKey: def.key }, select: { id: true } });
    const version = await db.checklistTemplateVersion.create({
      data: { templateId: template.id, version: 1, name: def.name, description: def.description, signatureMode: def.signatureMode, note: "Mitgelieferte Vorlage", createdByName },
      select: { id: true },
    });
    await db.checklistTemplateItem.createMany({ data: def.items.map((item, position) => ({ versionId: version.id, position, ...item })) });
    created++;
  }
  return created;
}
