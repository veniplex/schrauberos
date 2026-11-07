import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { DeviceForm } from "@/modules/it/network/device-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("network.devicesNew") };
}

export default async function NewDevicePage() {
  await requirePermission("network.edit");
  const [{ t }, locations] = await Promise.all([getI18n(), db.netLocation.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] })]);
  return (
    <>
      <PageHeader back={{ href: "/network/devices", label: t("nav.devices") }} help="it.network" title={t("network.devicesNew")} />
      <DeviceForm
        cancelHref="/network/devices"
        locations={locations}
        initial={{
          name: "", type: "workstation", status: "active", manufacturer: "", model: "", serialNumber: "", locationId: "",
          rackInfo: "", portCount: "", assignedTo: "", purchaseDate: "", warrantyUntil: "", monitorEnabled: false, notes: "",
        }}
      />
    </>
  );
}
