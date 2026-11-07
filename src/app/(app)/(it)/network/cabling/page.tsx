import type { Metadata } from "next";
import { ArrowRight, Trash2 } from "lucide-react";
import { Card, EmptyState, TextLink } from "@/components/ui/layout";
import { DataTable } from "@/components/ui/data-table";
import { Pagination } from "@/components/ui/pagination";
import { TabNav } from "@/components/ui/tab-nav";
import { clampPage, listLinks, pageWindow, parseListParams } from "@/lib/list-params";
import { PageHeader } from "@/components/ui/page-header";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
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

export default async function CablingPage({ searchParams }: { searchParams: Promise<{ tab?: string; page?: string }> }) {
  const session = await requirePermission("network.view");
  const [{ t, tp }, sp] = await Promise.all([getI18n(), searchParams]);
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as (typeof TABS)[number]) : "connections";
  const canEdit = session.can("network.edit");
  const canDelete = session.can("network.delete");

  return (
    <>
      <PageHeader title={t("network.cablingTitle")} description={t("network.cablingDescription")} help="it.network" />
      <TabNav label={t("network.cablingTitle")} items={TABS.map((id) => ({ href: `/network/cabling?tab=${id}`, label: t(`network.tabs.${id}`), active: tab === id }))} />

      {tab === "connections" ? <ConnectionsTab canEdit={canEdit} canDelete={canDelete} pageParam={sp.page} /> : <LocationsTab canEdit={canEdit} canDelete={canDelete} tp={tp} />}
    </>
  );
}

async function ConnectionsTab({ canEdit, canDelete, pageParam }: { canEdit: boolean; canDelete: boolean; pageParam?: string }) {
  const { t, tp } = await getI18n();
  const list = parseListParams({ page: pageParam }, { sorts: [], sort: "from" });
  const [total, devices] = await Promise.all([db.netConnection.count(), db.netDevice.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })]);
  const page = clampPage(list.page, total, list.pageSize);
  const connections = await db.netConnection.findMany({ include: { from: true, to: true }, orderBy: [{ from: { name: "asc" } }, { fromPort: "asc" }], ...pageWindow(page, list.pageSize) });
  const links = listLinks("/network/cabling", { tab: "connections" }, list, { sort: "from", dir: "asc" });
  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="cable-list-title">
        <h2 id="cable-list-title" className="mb-2 text-sm font-semibold">
          {t("network.sections.cableList")}
        </h2>
        <DataTable
          caption={t("network.sections.cableList")}
          rows={connections}
          rowKey={(c) => c.id}
          minWidth="44rem"
          summary={tp("network.connectionsCount", total)}
          footer={<Pagination page={page} pageSize={list.pageSize} total={total} hrefFor={links.pageHref} />}
          empty={<EmptyState title={t("network.connectionsEmpty")} hint={t("network.connectionsEmptyHint")} />}
          columns={[
            {
              id: "from",
              header: t("network.fields.fromDevice"),
              priority: "primary",
              cell: (c) => (
                <>
                  <TextLink href={`/network/devices/${c.from.id}`} className="font-medium text-inherit no-underline hover:underline">
                    {c.from.name}
                  </TextLink>
                  {c.fromPort ? <span className="ml-2 font-mono text-[13px] text-ink-muted">{c.fromPort}</span> : null}
                </>
              ),
            },
            {
              id: "to",
              header: t("network.fields.toDevice"),
              cell: (c) => (
                <>
                  <ArrowRight className="mr-2 inline size-4 text-ink-muted max-md:hidden" aria-hidden />
                  <TextLink href={`/network/devices/${c.to.id}`} className="font-medium text-inherit no-underline hover:underline">
                    {c.to.name}
                  </TextLink>
                  {c.toPort ? <span className="ml-2 font-mono text-[13px] text-ink-muted">{c.toPort}</span> : null}
                </>
              ),
            },
            {
              id: "cable",
              header: t("network.cols.cable"),
              cell: (c) => (
                <div className="text-sm">
                  {c.cableLabel ?? <span className="text-ink-muted">–</span>}
                  {c.notes ? <div className="text-xs text-ink-muted">{c.notes}</div> : null}
                </div>
              ),
            },
            ...(canDelete
              ? [
                  {
                    id: "actions",
                    header: t("common.actions"),
                    hideHeader: true,
                    align: "end" as const,
                    cell: (c: { id: string }) => (
                      <form action={deleteConnection}>
                        <input type="hidden" name="id" value={c.id} />
                        <ConfirmSubmitButton message={t("network.connectionDeleteConfirm")} label={t("common.delete")}>
                          <Trash2 className="size-3.5" aria-hidden />
                        </ConfirmSubmitButton>
                      </form>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </section>

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
                    <ConfirmSubmitButton message={t("network.locationDeleteConfirm")} label={t("common.delete")}>
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
