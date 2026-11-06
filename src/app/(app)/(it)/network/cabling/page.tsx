import type { Metadata } from "next";
import clsx from "clsx";
import Link from "next/link";
import { ArrowRight, Trash2 } from "lucide-react";
import { Card, EmptyState, PageHeader } from "@/components/ui/layout";
import { ConfirmSubmitButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { deleteConnection, deleteLocation } from "@/modules/it/network/actions";
import { ConnectionForm, LocationForm } from "@/modules/it/network/forms";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.cabling") };
}

const TABS = ["connections", "locations"] as const;

export default async function CablingPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await requirePermission("network.view");
  const [{ t, tp }, sp] = await Promise.all([getI18n(), searchParams]);
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as (typeof TABS)[number]) : "connections";
  const canEdit = session.can("network.edit");
  const canDelete = session.can("network.delete");

  return (
    <>
      <PageHeader title={t("network.cablingTitle")} description={t("network.cablingDescription")} />
      <nav aria-label={t("network.cablingTitle")} className="mb-5 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line">
        {TABS.map((id) => (
          <Link
            key={id}
            href={`/network/cabling?tab=${id}`}
            aria-current={tab === id ? "page" : undefined}
            className={clsx(
              "-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium",
              tab === id ? "border-accent text-accent-text" : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            {t(`network.tabs.${id}`)}
          </Link>
        ))}
      </nav>

      {tab === "connections" ? <ConnectionsTab canEdit={canEdit} canDelete={canDelete} /> : <LocationsTab canEdit={canEdit} canDelete={canDelete} tp={tp} />}
    </>
  );
}

async function ConnectionsTab({ canEdit, canDelete }: { canEdit: boolean; canDelete: boolean }) {
  const { t, tp } = await getI18n();
  const [connections, devices] = await Promise.all([
    db.netConnection.findMany({ include: { from: true, to: true }, orderBy: [{ from: { name: "asc" } }, { fromPort: "asc" }] }),
    db.netDevice.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <div className="flex flex-col gap-5">
      <Card title={t("network.sections.cableList")} padded={false}>
        {connections.length === 0 ? (
          <EmptyState title={t("network.connectionsEmpty")} hint={t("network.connectionsEmptyHint")} />
        ) : (
          <>
            <p className="border-b border-line px-4 py-2 text-sm text-ink-muted">{tp("network.connectionsCount", connections.length)}</p>
            <div className="overflow-x-auto">
              <table className="table min-w-[44rem]">
                <thead>
                  <tr>
                    <th>{t("network.fields.fromDevice")}</th>
                    <th aria-hidden />
                    <th>{t("network.fields.toDevice")}</th>
                    <th>{t("network.cols.cable")}</th>
                    {canDelete ? <th className="w-12" aria-label={t("common.actions")} /> : null}
                  </tr>
                </thead>
                <tbody>
                  {connections.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/network/devices/${c.from.id}`} className="font-medium hover:underline">
                          {c.from.name}
                        </Link>
                        {c.fromPort ? <span className="ml-2 font-mono text-[13px] text-ink-muted">{c.fromPort}</span> : null}
                      </td>
                      <td className="text-ink-muted">
                        <ArrowRight className="size-4" aria-hidden />
                      </td>
                      <td>
                        <Link href={`/network/devices/${c.to.id}`} className="font-medium hover:underline">
                          {c.to.name}
                        </Link>
                        {c.toPort ? <span className="ml-2 font-mono text-[13px] text-ink-muted">{c.toPort}</span> : null}
                      </td>
                      <td className="text-sm">
                        {c.cableLabel ?? <span className="text-ink-muted">–</span>}
                        {c.notes ? <div className="text-xs text-ink-muted">{c.notes}</div> : null}
                      </td>
                      {canDelete ? (
                        <td>
                          <form action={deleteConnection}>
                            <input type="hidden" name="id" value={c.id} />
                            <ConfirmSubmitButton message={t("network.connectionDeleteConfirm")} aria-label={t("common.delete")}>
                              <Trash2 className="size-3.5" aria-hidden />
                            </ConfirmSubmitButton>
                          </form>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {canEdit ? (
        <Card title={t("network.sections.connectionNew")}>
          {devices.length < 2 ? <p className="text-sm text-ink-muted">{t("network.needTwoDevices")}</p> : <ConnectionForm devices={devices} />}
        </Card>
      ) : null}
    </div>
  );
}

async function LocationsTab({ canEdit, canDelete, tp }: { canEdit: boolean; canDelete: boolean; tp: Awaited<ReturnType<typeof getI18n>>["tp"] }) {
  const { t } = await getI18n();
  const locations = await db.netLocation.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { devices: true } } },
  });
  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <Card title={t("network.sections.locations")} padded={false}>
        <p className="px-5 pt-3 text-sm text-ink-muted">{t("network.locationsHint")}</p>
        {locations.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-muted">{t("network.locationsEmpty")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {locations.map((l) => (
              <li key={l.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  {canEdit ? (
                    <LocationForm initial={{ id: l.id, name: l.name, description: l.description ?? "", sortOrder: l.sortOrder }} />
                  ) : (
                    <p className="text-sm">
                      <span className="font-medium">{l.name}</span>
                      {l.description ? <span className="text-ink-muted"> – {l.description}</span> : null}
                    </p>
                  )}
                </div>
                <span className="mt-2 text-xs text-ink-muted">{tp("network.deviceCount", l._count.devices)}</span>
                {canDelete ? (
                  <form action={deleteLocation}>
                    <input type="hidden" name="id" value={l.id} />
                    <ConfirmSubmitButton message={t("network.locationDeleteConfirm")} aria-label={t("common.delete")}>
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
            <p className="mb-2 text-sm font-medium">{t("network.locationNew")}</p>
            <LocationForm />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
