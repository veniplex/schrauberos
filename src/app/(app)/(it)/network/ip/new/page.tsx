import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { SubnetForm } from "@/modules/it/network/forms";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("network.subnetNew") };
}

export default async function NewSubnetPage() {
  await requirePermission("network.edit");
  const [{ t }, vlans] = await Promise.all([getI18n(), db.netVlan.findMany({ orderBy: { vlanId: "asc" } })]);
  return (
    <>
      <PageHeader title={t("network.subnetNew")} />
      <SubnetForm
        cancelHref="/network/ip"
        vlans={vlans}
        initial={{ name: "", cidr: "", vlanId: "", gateway: "", dnsServers: "", dhcpStart: "", dhcpEnd: "", description: "" }}
      />
    </>
  );
}
