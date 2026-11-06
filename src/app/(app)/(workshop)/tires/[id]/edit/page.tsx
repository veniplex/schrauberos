import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { TireSetForm } from "@/modules/workshop/tires/tire-set-form";
import { editTireSetInitial } from "@/modules/workshop/tires/form-initial";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("tires.edit") };
}

export default async function EditTireSetPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("tires.edit");
  const [{ t }, { id }] = await Promise.all([getI18n(), params]);
  const [set, locations] = await Promise.all([
    db.tireSet.findUnique({ where: { id }, include: { tires: true, vehicle: { include: { customer: true } } } }),
    db.tireSet.findMany({ where: { storageLocation: { not: null } }, select: { storageLocation: true }, distinct: ["storageLocation"], take: 200 }),
  ]);
  if (!set) notFound();

  return (
    <>
      <PageHeader title={t("tires.edit")} description={`${set.vehicle.plate}`} />
      <TireSetForm
        initial={editTireSetInitial(set)}
        locations={locations.map((l) => l.storageLocation!).sort()}
        cancelHref={`/tires/${set.id}`}
      />
    </>
  );
}
