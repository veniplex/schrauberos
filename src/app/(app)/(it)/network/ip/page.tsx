import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/layout";
import { ConfirmSubmitButton, LinkButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
import { parseCidr } from "@/modules/it/network/domain";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { deleteVlan } from "@/modules/it/network/actions";
import { VlanForm } from "@/modules/it/network/forms";
import { listSubnets } from "@/modules/it/network/queries";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.ipam") };
}

export default async function IpamPage() {
  const session = await requirePermission("network.view");
  const { t, tp, number } = await getI18n();
  const [subnets, vlans] = await Promise.all([listSubnets(), db.netVlan.findMany({ orderBy: { vlanId: "asc" }, include: { _count: { select: { subnets: true } } } })]);
  const canEdit = session.can("network.edit");
  const canDelete = session.can("network.delete");

  return (
    <>
      <PageHeader
        title={t("network.ipamTitle")}
        description={t("network.ipamDescription")}
        actions={
          canEdit ? (
            <LinkButton href="/network/ip/new" variant="primary">
              <Plus className="size-4" aria-hidden /> {t("network.subnetNew")}
            </LinkButton>
          ) : null
        }
      />

      <div className="flex flex-col gap-5">
        <Card title={t("network.sections.subnets")} padded={false}>
          {subnets.length === 0 ? (
            <EmptyState title={t("network.subnetsEmpty")} hint={t("network.subnetsEmptyHint")} />
          ) : (
            <div className="overflow-x-auto">
              <table className="table min-w-[44rem]">
                <thead>
                  <tr>
                    <th>{t("network.cols.subnet")}</th>
                    <th>{t("network.fields.cidr")}</th>
                    <th>VLAN</th>
                    <th>{t("network.fields.gateway")}</th>
                    <th className="min-w-44">{t("network.cols.utilization")}</th>
                  </tr>
                </thead>
                <tbody>
                  {subnets.map((s) => {
                    const hosts = parseCidr(s.cidr)?.hosts ?? 0;
                    const used = s._count.ips;
                    const pct = hosts ? Math.min(100, Math.round((used / hosts) * 100)) : 0;
                    return (
                      <tr key={s.id} className="row-link">
                        <td>
                          <Link href={`/network/ip/${s.id}`} className="font-medium hover:underline">
                            {s.name}
                          </Link>
                        </td>
                        <td className="font-mono text-[13px]">{s.cidr}</td>
                        <td>{s.vlan ? <Badge tone="info">VLAN {s.vlan.vlanId}</Badge> : <span className="text-ink-muted">–</span>}</td>
                        <td className="font-mono text-[13px]">{s.gateway ?? <span className="font-sans text-ink-muted">–</span>}</td>
                        <td>
                          <div className="flex items-center gap-3">
                            <div className="h-2 w-28 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${pct} %`}>
                              <div className={`h-full ${pct > 90 ? "bg-danger-ink" : pct > 75 ? "bg-warning-ink" : "bg-accent"}`} style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs text-ink-muted tabular">
                              {number(used)} / {number(hosts)}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title={t("network.sections.vlans")} padded={false}>
          <p className="px-5 pt-3 text-sm text-ink-muted">{t("network.vlansHint")}</p>
          {vlans.length === 0 ? (
            <p className="px-5 py-4 text-sm text-ink-muted">{t("network.vlansEmpty")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {vlans.map((v) => (
                <li key={v.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                  {canEdit ? (
                    <div className="min-w-0 flex-1">
                      <VlanForm initial={{ id: v.id, vlanId: v.vlanId, name: v.name, description: v.description ?? "" }} />
                    </div>
                  ) : (
                    <div className="min-w-0 flex-1 text-sm">
                      <span className="font-medium">VLAN {v.vlanId}</span> · {v.name}
                      {v.description ? <span className="text-ink-muted"> – {v.description}</span> : null}
                    </div>
                  )}
                  <span className="mt-2 text-xs text-ink-muted">{tp("network.subnetCount", v._count.subnets)}</span>
                  {canDelete ? (
                    <form action={deleteVlan}>
                      <input type="hidden" name="id" value={v.id} />
                      <ConfirmSubmitButton message={t("network.vlanDeleteConfirm")} aria-label={t("common.delete")}>
                        <Trash2 className="size-3.5" aria-hidden />
                      </ConfirmSubmitButton>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canEdit ? (
            <div className="border-t border-line px-5 py-4">
              <p className="mb-2 text-sm font-medium">{t("network.vlanNew")}</p>
              <VlanForm />
            </div>
          ) : null}
        </Card>
      </div>
    </>
  );
}
