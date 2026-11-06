import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { Badge, Card, DefinitionList, EmptyState, PageHeader, Table } from "@/components/ui/layout";
import { ConfirmSubmitButton, LinkButton } from "@/components/ui/buttons";
import { UrlModal } from "@/components/ui/modal";
import { getI18n } from "@/i18n/server";
import { compareIPv4, freeRanges, nextFreeIp, parseCidr } from "@/modules/it/network/domain";
import { requirePermission, sessionIfAllowed } from "@/server/auth/session";
import { db } from "@/server/db";
import { deleteIp } from "@/modules/it/network/actions";
import { versionOf } from "@/lib/concurrency";
import { IpForm } from "@/modules/it/network/forms";

export async function generateMetadata({ params }: { params: Promise<{ subnetId: string }> }): Promise<Metadata> {
  const { subnetId } = await params;
  if (!(await sessionIfAllowed("network.view"))) return {};
  const s = await db.netSubnet.findUnique({ where: { id: subnetId } });
  return { title: s ? `${s.name} (${s.cidr})` : undefined };
}

type SearchParams = { new?: string; edit?: string; address?: string; device?: string };

export default async function SubnetPage({
  params,
  searchParams,
}: {
  params: Promise<{ subnetId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const session = await requirePermission("network.view");
  const [{ subnetId }, sp, i18n] = await Promise.all([params, searchParams, getI18n()]);
  const { t, td, number } = i18n;

  const [subnet, devices] = await Promise.all([
    db.netSubnet.findUnique({ where: { id: subnetId }, include: { vlan: true, ips: { include: { device: true } } } }),
    db.netDevice.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  if (!subnet) notFound();

  const net = parseCidr(subnet.cidr);
  const ips = [...subnet.ips].sort((a, b) => compareIPv4(a.address, b.address));
  const used = ips.map((i) => i.address);
  const free = freeRanges(subnet.cidr, used);
  const freeCount = free.reduce((n, r) => n + r.count, 0);
  const canEdit = session.can("network.edit");
  const base = `/network/ip/${subnet.id}`;

  const editing = sp.edit ? ips.find((i) => i.id === sp.edit) : undefined;
  const showModal = canEdit && (editing || sp.new);

  return (
    <>
      <PageHeader
        title={subnet.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{subnet.cidr}</span>
            {subnet.vlan ? <Badge tone="info">VLAN {subnet.vlan.vlanId} · {subnet.vlan.name}</Badge> : null}
          </span>
        }
        actions={
          canEdit ? (
            <>
              <LinkButton href={`${base}?new=1&address=${nextFreeIp(subnet.cidr, used) ?? ""}`} variant="primary">
                <Plus className="size-4" aria-hidden /> {t("network.ipNew")}
              </LinkButton>
              <LinkButton href={`${base}/edit`}>
                <Pencil className="size-4" aria-hidden /> {t("common.edit")}
              </LinkButton>
            </>
          ) : null
        }
      />

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card title={t("network.sections.addresses", { count: ips.length })} padded={false}>
            {ips.length === 0 ? (
              <EmptyState title={t("network.ipsEmpty")} />
            ) : (
              <Table className="min-w-[40rem]">
                  <thead>
                    <tr>
                      <th>{t("network.cols.address")}</th>
                      <th>{t("network.fields.ipKind")}</th>
                      <th>{t("network.fields.device")}</th>
                      <th>{t("network.cols.hostname")}</th>
                      <th>{t("network.cols.mac")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ips.map((ip) => (
                      <tr key={ip.id} className="row-link">
                        <td className="font-mono text-[13px] whitespace-nowrap">
                          {canEdit ? (
                            <Link href={`${base}?edit=${ip.id}`} className="font-medium inline-flex min-h-(--tap-row) min-w-(--tap-row) items-center hover:underline">
                              {ip.address}
                            </Link>
                          ) : (
                            ip.address
                          )}
                        </td>
                        <td>
                          <Badge tone={ip.kind === "gateway" ? "accent" : "neutral"}>{td(`enums.ipKind.${ip.kind}`, ip.kind)}</Badge>
                        </td>
                        <td className="text-sm">
                          {ip.device ? (
                            <Link href={`/network/devices/${ip.device.id}`} className="text-accent-text inline-flex min-h-(--tap-row) min-w-(--tap-row) items-center hover:underline">
                              {ip.device.name}
                            </Link>
                          ) : (
                            <span className="text-ink-muted">–</span>
                          )}
                        </td>
                        <td className="text-sm">{ip.hostname ?? <span className="text-ink-muted">–</span>}</td>
                        <td className="font-mono text-[13px]">{ip.mac ?? <span className="font-sans text-ink-muted">–</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card title={t("network.sections.subnetInfo")}>
            <DefinitionList
              items={[
                { label: t("network.fields.gateway"), value: subnet.gateway ? <span className="font-mono">{subnet.gateway}</span> : null },
                { label: t("network.fields.dns"), value: subnet.dnsServers ? <span className="font-mono">{subnet.dnsServers}</span> : null },
                {
                  label: t("network.fields.dhcpRange"),
                  value: subnet.dhcpStart && subnet.dhcpEnd ? <span className="font-mono">{subnet.dhcpStart} – {subnet.dhcpEnd}</span> : null,
                },
                { label: t("network.cols.utilization"), value: `${number(ips.length)} / ${number(net?.hosts ?? 0)}` },
                { label: t("network.fields.description"), value: subnet.description },
              ]}
            />
          </Card>

          <Card title={t("network.sections.freeRanges", { count: number(freeCount) })} padded={false}>
            {free.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-muted">{t("network.noFree")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {free.slice(0, 12).map((r) => (
                  <li key={r.from} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                    <span className="font-mono text-[13px]">{r.count === 1 ? r.from : `${r.from} – ${r.to}`}</span>
                    {canEdit ? (
                      <Link href={`${base}?new=1&address=${r.from}`} className="text-accent-text inline-flex min-h-(--tap-row) min-w-(--tap-row) items-center hover:underline">
                        {t("network.useAddress")}
                      </Link>
                    ) : null}
                  </li>
                ))}
                {free.length > 12 ? <li className="px-5 py-2.5 text-xs text-ink-muted">{t("network.moreRanges", { count: free.length - 12 })}</li> : null}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {showModal ? (
        <UrlModal
          key={editing?.id ?? `new-${sp.address ?? ""}-${sp.device ?? ""}`}
          title={editing ? t("network.ipEdit") : t("network.ipNew")}
          closeHref={base}
        >
          <div className="flex flex-col gap-5">
            <IpForm
              cidr={subnet.cidr}
              devices={devices}
              returnTo={base}
              closeHref={base}
              initial={{
                id: editing?.id,
                version: editing ? versionOf(editing) : undefined,
                subnetId: subnet.id,
                address: editing?.address ?? sp.address ?? "",
                deviceId: editing?.deviceId ?? sp.device ?? "",
                hostname: editing?.hostname ?? "",
                kind: editing?.kind ?? "static",
                mac: editing?.mac ?? "",
                notes: editing?.notes ?? "",
              }}
            />
            {editing && session.can("network.delete") ? (
              <form action={deleteIp} className="border-t border-line pt-4">
                <input type="hidden" name="id" value={editing.id} />
                <input type="hidden" name="returnTo" value={base} />
                <ConfirmSubmitButton message={t("network.ipDeleteConfirm", { address: editing.address })}>{t("network.ipDelete")}</ConfirmSubmitButton>
              </form>
            ) : null}
          </div>
        </UrlModal>
      ) : null}
    </>
  );
}
