import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { Menu, MenuLink } from "@/components/ui/menu";
import { Badge, Card, DefinitionList, EmptyState, TextLink, StatusBadge, DangerZone } from "@/components/ui/layout";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { DUE_TONE } from "@/lib/due";
import { LinkButton } from "@/components/ui/buttons";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { getI18n } from "@/i18n/server";
import { compareIPv4, nextFreeIp, warrantyState } from "@/modules/it/network/domain";
import { requirePermission, sessionIfAllowed } from "@/server/auth/session";
import { db } from "@/server/db";
import { deleteDevice } from "@/modules/it/network/actions";
import { checkDevices } from "@/modules/it/network/queries";
import { DeviceStatusBadge, LinkStateBadge, MonitoringNotice } from "@/modules/it/network/ui";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!(await sessionIfAllowed("network.view"))) return {};
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
        back={{ href: "/network/devices", label: t("nav.devices") }} help="it.network"
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
          <MonitoringNotice t={t} />
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <div className="min-w-0 flex flex-col gap-5 md:col-span-2">
          <Card
            title={t("network.sections.ips")}
            padded={false}
            actions={
              canEdit && subnets.length ? (
                <Menu
                  label={t("network.assignIp")}
                  variant="secondary"
                  size="sm"
                  align="end"
                  panelClassName="w-64"
                  trigger={
                    <>
                      <Plus className="size-3.5" aria-hidden /> {t("network.assignIp")}
                    </>
                  }
                >
                  {subnets.map((s) => (
                    <MenuLink
                      key={s.id}
                      href={`/network/ip/${s.id}?new=1&device=${device.id}&address=${nextFreeIp(s.cidr, s.ips.map((i) => i.address)) ?? ""}`}
                      className="flex-col items-start justify-center gap-0 py-1"
                    >
                      <span className="font-medium">{s.name}</span>
                      <span className="font-mono text-xs text-ink-muted">{s.cidr}</span>
                    </MenuLink>
                  ))}
                </Menu>
              ) : null
            }
          >
            {ips.length === 0 ? (
              <EmptyState title={t("network.noIps")} />
            ) : (
              <DataTable
                bare
                caption={t("network.sections.ips")}
                rows={ips}
                rowKey={(ip) => ip.id}
                minWidth="32rem"
                columns={[
                  { id: "address", header: t("network.cols.address"), priority: "primary", cell: (ip) => <span className="font-mono text-[13px]">{ip.address}</span> },
                  { id: "hostname", header: t("network.cols.hostname"), cell: (ip) => ip.hostname ?? <span className="text-ink-muted">–</span> },
                  { id: "mac", header: t("network.cols.mac"), cell: (ip) => (ip.mac ? <span className="font-mono text-[13px]">{ip.mac}</span> : <span className="text-ink-muted">–</span>) },
                  { id: "subnet", header: t("network.cols.subnet"), cell: (ip) => <TextLink href={`/network/ip/${ip.subnetId}`}>{ip.subnet.name}</TextLink> },
                ]}
              />
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
                        <TextLink href={`/network/devices/${l.other.id}`} className="mt-0.5 flex truncate" title={`${l.other.name}${l.otherPort ? ` · ${l.otherPort}` : ""}`}>
                          {l.other.name}
                        </TextLink>
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
              <DataTable
                bare
                caption={t("network.sections.connections")}
                rows={links}
                rowKey={(l) => l.id}
                minWidth="32rem"
                columns={[
                  { id: "port", header: t("network.cols.port"), priority: "primary", cell: (l) => <span className="font-mono text-[13px]">{l.port ?? "–"}</span> },
                  {
                    id: "other",
                    header: t("network.cols.connectedTo"),
                    cell: (l) => (
                      <Link href={`/network/devices/${l.other.id}`} className="inline-flex min-h-(--tap-row) min-w-(--tap-row) items-center font-medium hover:underline">
                        {l.other.name}
                      </Link>
                    ),
                  },
                  { id: "otherPort", header: t("network.cols.otherPort"), cell: (l) => <span className="font-mono text-[13px]">{l.otherPort ?? "–"}</span> },
                  { id: "cable", header: t("network.cols.cable"), cell: (l) => l.cable ?? <span className="text-ink-muted">–</span> },
                ]}
              />
            )}
          </Card>
        </div>

        <div className="min-w-0 flex flex-col gap-5">
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
                    <StatusBadge tone={w ? DUE_TONE[w] : "neutral"}>
                      {date(device.warrantyUntil)}
                      {w === "expired" ? ` · ${t("network.warranty.expired")}` : w === "soon" ? ` · ${t("network.warranty.soon")}` : ""}
                    </StatusBadge>
                  ) : null,
                },
                { label: t("common.notes"), value: device.notes },
              ]}
            />
          </Card>

          {session.can("network.delete") ? (
            <DangerZone title={t("common.dangerZone")}>
              <form action={deleteDevice}>
                <input type="hidden" name="id" value={device.id} />
                <ConfirmSubmitButton message={t("network.devicesDeleteConfirm", { name: device.name })}>{t("network.devicesDelete")}</ConfirmSubmitButton>
              </form>
            </DangerZone>
          ) : null}
        </div>
      </div>
    </>
  );
}
