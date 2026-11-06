import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { Badge, Card, DefinitionList, EmptyState, PageHeader } from "@/components/ui/layout";
import { ConfirmSubmitButton, LinkButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
import { compareIPv4, nextFreeIp, warrantyState } from "@/modules/it/network/domain";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { deleteDevice } from "@/modules/it/network/actions";
import { checkDevices } from "@/modules/it/network/queries";
import { DemoNotice, DeviceStatusBadge, LinkStateBadge } from "@/modules/it/network/ui";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const d = await db.netDevice.findUnique({ where: { id } });
  return { title: d?.name };
}

export default async function DevicePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("network.view");
  const { id } = await params;
  const i18n = await getI18n();
  const { t, td, date } = i18n;

  const [device, subnets] = await Promise.all([
    db.netDevice.findUnique({
      where: { id },
      include: {
        location: true,
        ips: { include: { subnet: true } },
        connectionsFrom: { include: { to: true } },
        connectionsTo: { include: { from: true } },
      },
    }),
    db.netSubnet.findMany({ include: { ips: { select: { address: true } } }, orderBy: { cidr: "asc" } }),
  ]);
  if (!device) notFound();

  const checks = await checkDevices([device]);
  const canEdit = session.can("network.edit");
  const w = warrantyState(device.warrantyUntil);
  const ips = [...device.ips].sort((a, b) => compareIPv4(a.address, b.address));

  // Alle Kabel aus Sicht dieses Geräts: eigener Port, Gegenstelle
  const links = [
    ...device.connectionsFrom.map((c) => ({ id: c.id, port: c.fromPort, other: c.to, otherPort: c.toPort, cable: c.cableLabel })),
    ...device.connectionsTo.map((c) => ({ id: c.id, port: c.toPort, other: c.from, otherPort: c.fromPort, cable: c.cableLabel })),
  ];
  const byPort = new Map(links.filter((l) => l.port).map((l) => [l.port!, l]));
  const ports = device.portCount ? Array.from({ length: device.portCount }, (_, i) => String(i + 1)) : [];

  return (
    <>
      <PageHeader
        title={device.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge>{td(`enums.deviceType.${device.type}`, device.type)}</Badge>
            <DeviceStatusBadge status={device.status} td={td} />
            {device.monitorEnabled ? <LinkStateBadge check={checks.get(device.id)} i18n={i18n} /> : null}
          </span>
        }
        actions={
          canEdit ? (
            <LinkButton href={`/network/devices/${device.id}/edit`}>
              <Pencil className="size-4" aria-hidden /> {t("common.edit")}
            </LinkButton>
          ) : null
        }
      />
      {device.monitorEnabled ? (
        <div className="mb-5">
          <DemoNotice t={t} />
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="flex flex-col gap-5 xl:col-span-2">
          <Card
            title={t("network.sections.ips")}
            padded={false}
            actions={
              canEdit && subnets.length ? (
                <details className="relative">
                  <summary className="btn btn-secondary btn-sm list-none [&::-webkit-details-marker]:hidden">
                    <Plus className="size-3.5" aria-hidden /> {t("network.assignIp")}
                  </summary>
                  <ul className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-line bg-surface p-1 shadow-pop">
                    {subnets.map((s) => (
                      <li key={s.id}>
                        <Link
                          href={`/network/ip/${s.id}?new=1&device=${device.id}&address=${nextFreeIp(s.cidr, s.ips.map((i) => i.address)) ?? ""}`}
                          className="flex min-h-9 flex-col justify-center rounded-md px-3 py-1 text-sm hover:bg-surface-hover"
                        >
                          <span className="font-medium">{s.name}</span>
                          <span className="font-mono text-xs text-ink-muted">{s.cidr}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null
            }
          >
            {ips.length === 0 ? (
              <EmptyState title={t("network.noIps")} />
            ) : (
              <div className="overflow-x-auto">
                <table className="table min-w-[32rem]">
                  <thead>
                    <tr>
                      <th>{t("network.cols.address")}</th>
                      <th>{t("network.cols.hostname")}</th>
                      <th>{t("network.cols.mac")}</th>
                      <th>{t("network.cols.subnet")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ips.map((ip) => (
                      <tr key={ip.id}>
                        <td className="font-mono text-[13px]">{ip.address}</td>
                        <td className="text-sm">{ip.hostname ?? <span className="text-ink-muted">–</span>}</td>
                        <td className="font-mono text-[13px]">{ip.mac ?? <span className="font-sans text-ink-muted">–</span>}</td>
                        <td className="text-sm">
                          <Link href={`/network/ip/${ip.subnetId}`} className="text-accent-text hover:underline">
                            {ip.subnet.name}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {ports.length ? (
            <Card title={t("network.sections.ports", { count: ports.length })}>
              <ol className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
                {ports.map((p) => {
                  const l = byPort.get(p);
                  return (
                    <li
                      key={p}
                      className={`min-w-0 rounded-md border p-2 text-xs ${l ? "border-line-strong bg-accent-subtle" : "border-dashed border-line bg-surface-2"}`}
                    >
                      <span className="tabular font-semibold">{p}</span>
                      {l ? (
                        <Link href={`/network/devices/${l.other.id}`} className="mt-0.5 block truncate text-accent-text hover:underline" title={`${l.other.name}${l.otherPort ? ` · ${l.otherPort}` : ""}`}>
                          {l.other.name}
                        </Link>
                      ) : (
                        <span className="mt-0.5 block text-ink-muted">{t("network.portFree")}</span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </Card>
          ) : null}

          <Card title={t("network.sections.connections")} padded={false}>
            {links.length === 0 ? (
              <EmptyState title={t("network.noConnections")} />
            ) : (
              <div className="overflow-x-auto">
                <table className="table min-w-[32rem]">
                  <thead>
                    <tr>
                      <th>{t("network.cols.port")}</th>
                      <th>{t("network.cols.connectedTo")}</th>
                      <th>{t("network.cols.otherPort")}</th>
                      <th>{t("network.cols.cable")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {links.map((l) => (
                      <tr key={l.id}>
                        <td className="font-mono text-[13px]">{l.port ?? "–"}</td>
                        <td>
                          <Link href={`/network/devices/${l.other.id}`} className="font-medium hover:underline">
                            {l.other.name}
                          </Link>
                        </td>
                        <td className="font-mono text-[13px]">{l.otherPort ?? "–"}</td>
                        <td className="text-sm">{l.cable ?? <span className="text-ink-muted">–</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card title={t("network.sections.device")}>
            <DefinitionList
              items={[
                { label: t("network.fields.manufacturer"), value: [device.manufacturer, device.model].filter(Boolean).join(" ") },
                { label: t("network.fields.serialNumber"), value: device.serialNumber ? <span className="font-mono">{device.serialNumber}</span> : null },
                { label: t("network.fields.location"), value: [device.location?.name, device.rackInfo].filter(Boolean).join(" · ") },
                { label: t("network.fields.assignedTo"), value: device.assignedTo },
                { label: t("network.fields.purchaseDate"), value: device.purchaseDate ? date(device.purchaseDate) : null },
                {
                  label: t("network.fields.warrantyUntil"),
                  value: device.warrantyUntil ? (
                    <Badge tone={w === "expired" ? "danger" : w === "soon" ? "warning" : "neutral"}>
                      {date(device.warrantyUntil)}
                      {w === "expired" ? ` · ${t("network.warranty.expired")}` : w === "soon" ? ` · ${t("network.warranty.soon")}` : ""}
                    </Badge>
                  ) : null,
                },
                { label: t("common.notes"), value: device.notes },
              ]}
            />
          </Card>

          {session.can("network.delete") ? (
            <form action={deleteDevice}>
              <input type="hidden" name="id" value={device.id} />
              <ConfirmSubmitButton message={t("network.devicesDeleteConfirm", { name: device.name })}>{t("network.devicesDelete")}</ConfirmSubmitButton>
            </form>
          ) : null}
        </div>
      </div>
    </>
  );
}
