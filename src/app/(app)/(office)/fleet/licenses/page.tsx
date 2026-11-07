import type { Metadata } from "next";
import { ShieldCheck, Trash2 } from "lucide-react";
import { Card, EmptyState, StatusBadge } from "@/components/ui/layout";
import { DataTable } from "@/components/ui/data-table";
import { TabNav } from "@/components/ui/tab-nav";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton } from "@/components/ui/buttons";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { UrlModal } from "@/components/ui/modal";
import { getI18n } from "@/i18n/server";
import { todayInput } from "@/lib/dates";
import { DUE_TONE, dueState } from "@/lib/due";
import { employeeName } from "@/modules/office/employees/public";
import { FLEET_WARN_DAYS } from "@/modules/office/fleet/domain";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { deleteLicenseCheck } from "@/modules/office/fleet/actions";
import { LicenseCheckForm } from "@/modules/office/fleet/forms";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("fleet.tabs.licenses") };
}

export default async function LicensesPage({ searchParams }: { searchParams: Promise<{ check?: string }> }) {
  const session = await requirePermission("fleet.view");
  const [{ t, date }, sp] = await Promise.all([getI18n(), searchParams]);
  const canEdit = session.can("fleet.edit");

  // Fahrer = aktive Mitarbeiter, denen ein nicht verkauftes Firmenfahrzeug zugeordnet ist
  const drivers = await db.employee.findMany({
    where: { active: true, fleetVehicles: { some: { status: { not: "sold" } } } },
    include: {
      fleetVehicles: { where: { status: { not: "sold" } }, select: { id: true, plate: true } },
      licenseChecks: { orderBy: { checkedAt: "desc" }, take: 3 },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  const rows = drivers.map((d) => {
    const last = d.licenseChecks[0];
    return { d, last, state: last ? dueState(last.nextDue, FLEET_WARN_DAYS) : ("expired" as const) };
  });
  const allEmployees = canEdit ? await db.employee.findMany({ where: { active: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] }) : [];

  return (
    <>
      <PageHeader title={t("fleet.title")} description={t("fleet.licenseDescription")} help="office.fleet" />
      <TabNav
        label={t("fleet.title")}
        items={[
          { href: "/fleet", label: t("fleet.tabs.vehicles"), active: false },
          { href: "/fleet/licenses", label: t("fleet.tabs.licenses"), active: true },
        ]}
      />

      <DataTable
        caption={t("fleet.tabs.licenses")}
        rows={rows}
        rowKey={({ d }) => d.id}
        rowHref={({ d }) => `/employees/${d.id}`}
        minWidth="44rem"
        empty={
          <Card title={t("fleet.tabs.licenses")} padded={false}>
            <EmptyState title={t("fleet.noDrivers")} hint={t("fleet.noDriversHint")} />
          </Card>
        }
        columns={[
          { id: "driver", header: t("fleet.fields.driver"), priority: "primary", cell: ({ d }) => employeeName(d) },
          { id: "vehicles", header: t("fleet.cols.vehicles"), cell: ({ d }) => <span className="font-mono text-[13px]">{d.fleetVehicles.map((v) => v.plate).join(", ")}</span> },
          {
            id: "last",
            header: t("fleet.cols.lastCheck"),
            cell: ({ last }) =>
              last ? (
                <div className="text-sm tabular">
                  {date(last.checkedAt)}
                  <div className="text-xs text-ink-muted">{[last.method, last.checkedByName].filter(Boolean).join(" · ")}</div>
                </div>
              ) : (
                <span className="text-ink-muted">–</span>
              ),
          },
          {
            id: "next",
            header: t("fleet.cols.nextCheck"),
            cell: ({ last, state }) =>
              last ? <StatusBadge tone={state ? DUE_TONE[state] : "neutral"}>{date(last.nextDue)}</StatusBadge> : <StatusBadge tone="danger">{t("fleet.neverChecked")}</StatusBadge>,
          },
          ...(canEdit
            ? [
                {
                  id: "actions",
                  header: t("common.actions"),
                  hideHeader: true,
                  align: "end" as const,
                  cell: ({ d }: { d: { id: string } }) => (
                    <LinkButton size="sm" href={`/fleet/licenses?check=${d.id}`}>
                      <ShieldCheck className="size-3.5" aria-hidden /> {t("fleet.checkNow")}
                    </LinkButton>
                  ),
                },
              ]
            : []),
        ]}
      />

      {drivers.some((d) => d.licenseChecks.length > 1) ? (
        <div className="mt-5">
          <Card title={t("fleet.history")} padded={false}>
            <ul className="divide-y divide-line">
              {drivers.flatMap((d) =>
                d.licenseChecks.slice(1).map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                    <span>
                      <span className="font-medium">{employeeName(d)}</span> <span className="text-ink-muted tabular">· {date(c.checkedAt)}</span>
                    </span>
                    {canEdit ? (
                      <form action={deleteLicenseCheck}>
                        <input type="hidden" name="id" value={c.id} />
                        <ConfirmSubmitButton message={t("fleet.deleteConfirm")} label={t("common.delete")}>
                          <Trash2 className="size-3.5" aria-hidden />
                        </ConfirmSubmitButton>
                      </form>
                    ) : null}
                  </li>
                )),
              )}
            </ul>
          </Card>
        </div>
      ) : null}

      {canEdit && sp.check ? (
        <UrlModal title={t("fleet.checkNow")} closeHref="/fleet/licenses">
          <LicenseCheckForm employees={allEmployees.map((e) => ({ id: e.id, name: employeeName(e) }))} initialEmployeeId={sp.check} today={todayInput()} closeHref="/fleet/licenses" />
        </UrlModal>
      ) : null}
    </>
  );
}
