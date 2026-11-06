import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { TireSetForm } from "@/modules/workshop/tires/tire-set-form";
import { newTireSetInitial } from "@/modules/workshop/tires/form-initial";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("tires.new") };
}

export default async function NewTireSetPage({ searchParams }: { searchParams: Promise<{ vehicle?: string }> }) {
  await requirePermission("tires.create");
  const [{ t }, sp] = await Promise.all([getI18n(), searchParams]);
  const [vehicle, locations] = await Promise.all([
    sp.vehicle ? db.vehicle.findUnique({ where: { id: sp.vehicle }, include: { customer: true } }) : null,
    db.tireSet.findMany({ where: { storageLocation: { not: null } }, select: { storageLocation: true }, distinct: ["storageLocation"], take: 200 }),
  ]);

  return (
    <>
      <PageHeader title={t("tires.new")} description={t("tires.newDescription")} />
      <TireSetForm
        initial={newTireSetInitial(vehicle)}
        locations={locations.map((l) => l.storageLocation!).sort()}
        cancelHref="/tires"
      />
    </>
  );
}
