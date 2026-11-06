import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { toDateInput } from "@/lib/dates";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { DeviceForm } from "@/modules/it/network/device-form";
import { versionOf } from "@/lib/concurrency";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("network.devicesEdit") };
}

export default async function EditDevicePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("network.edit");
  const [{ t }, { id }] = await Promise.all([getI18n(), params]);
  const [device, locations] = await Promise.all([
    db.netDevice.findUnique({ where: { id } }),
    db.netLocation.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  if (!device) notFound();

  return (
    <>
      <PageHeader title={t("network.devicesEdit")} description={device.name} />
      <DeviceForm
        cancelHref={`/network/devices/${device.id}`}
        locations={locations}
        initial={{
          id: device.id,
          version: versionOf(device),
          name: device.name,
          type: device.type,
          status: device.status,
          manufacturer: device.manufacturer ?? "",
          model: device.model ?? "",
          serialNumber: device.serialNumber ?? "",
          locationId: device.locationId ?? "",
          rackInfo: device.rackInfo ?? "",
          portCount: device.portCount != null ? String(device.portCount) : "",
          assignedTo: device.assignedTo ?? "",
          purchaseDate: device.purchaseDate ? toDateInput(device.purchaseDate) : "",
          warrantyUntil: device.warrantyUntil ? toDateInput(device.warrantyUntil) : "",
          monitorEnabled: device.monitorEnabled,
          notes: device.notes ?? "",
        }}
      />
    </>
  );
}
