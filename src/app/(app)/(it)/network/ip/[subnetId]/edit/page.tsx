import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { getI18n } from "@/i18n/server";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { deleteSubnet } from "@/modules/it/network/actions";
import { SubnetForm } from "@/modules/it/network/forms";
import { DangerZone } from "@/components/ui/layout";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("network.subnetEdit") };
}

export default async function EditSubnetPage({ params }: { params: Promise<{ subnetId: string }> }) {
  const session = await requirePermission("network.edit");
  const [{ t }, { subnetId }] = await Promise.all([getI18n(), params]);
  const [subnet, vlans] = await Promise.all([
    db.netSubnet.findUnique({ where: { id: subnetId }, include: { _count: { select: { ips: true } } } }),
    db.netVlan.findMany({ orderBy: { vlanId: "asc" } }),
  ]);
  if (!subnet) notFound();

  return (
    <>
      <PageHeader breadcrumbs={[{ href: "/network/ip", label: t("nav.ipam") }, { href: `/network/ip/${subnet.id}`, label: subnet.name }]} help="it.network" title={t("network.subnetEdit")} description={`${subnet.name} · ${subnet.cidr}`} />
      <div className="flex flex-col gap-4">
        <SubnetForm
          cancelHref={`/network/ip/${subnet.id}`}
          vlans={vlans}
          initial={{
            id: subnet.id,
            name: subnet.name,
            cidr: subnet.cidr,
            vlanId: subnet.vlanId ?? "",
            gateway: subnet.gateway ?? "",
            dnsServers: subnet.dnsServers ?? "",
            dhcpStart: subnet.dhcpStart ?? "",
            dhcpEnd: subnet.dhcpEnd ?? "",
            description: subnet.description ?? "",
          }}
        />
        {session.can("network.delete") ? (
          <DangerZone title={t("common.dangerZone")} className="max-w-3xl">
            <form action={deleteSubnet}>
              <input type="hidden" name="id" value={subnet.id} />
              <ConfirmSubmitButton message={t("network.subnetDeleteConfirm", { count: subnet._count.ips })}>{t("network.subnetDelete")}</ConfirmSubmitButton>
            </form>
          </DangerZone>
        ) : null}
      </div>
    </>
  );
}
