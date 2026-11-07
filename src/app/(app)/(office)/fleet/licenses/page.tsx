import type { Metadata } from "next";
import clsx from "clsx";
import Link from "next/link";
import { ShieldCheck, Trash2 } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader, Table } from "@/components/ui/layout";
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

  const tab = (href: string, label: string, active: boolean) => (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={clsx("-mb-px inline-flex min-h-(--tap) items-center whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium", active ? "border-accent text-accent-text" : "border-transparent text-ink-muted hover:text-ink")}
    >
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader title={t("fleet.title")} description={t("fleet.licenseDescription")} />
      <nav className="mb-5 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line" aria-label={t("fleet.title")}>
        {tab("/fleet", t("fleet.tabs.vehicles"), false)}
        {tab("/fleet/licenses", t("fleet.tabs.licenses"), true)}
      </nav>

      <Card title={t("fleet.tabs.licenses")} padded={false}>
        {rows.length === 0 ? (
          <EmptyState title={t("fleet.noDrivers")} hint={t("fleet.noDriversHint")} />
        ) : (
          <Table className="min-w-[44rem]">
              <thead>
                <tr>
                  <th>{t("fleet.fields.driver")}</th>
                  <th>{t("fleet.cols.vehicles")}</th>
                  <th>{t("fleet.cols.lastCheck")}</th>
                  <th>{t("fleet.cols.nextCheck")}</th>
                  {canEdit ? <th className="w-40" aria-label={t("common.actions")} /> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ d, last, state }) => (
                  <tr key={d.id}>
                    <td>
                      <Link href={`/employees/${d.id}`} className="font-medium inline-flex min-h-(--tap-row) min-w-(--tap-row) items-center hover:underline">
                        {employeeName(d)}
                      </Link>
                    </td>
                    <td className="font-mono text-[13px]">{d.fleetVehicles.map((v) => v.plate).join(", ")}</td>
                    <td className="text-sm tabular">
                      {last ? (
                        <>
                          {date(last.checkedAt)}
                          <div className="text-xs text-ink-muted">{[last.method, last.checkedByName].filter(Boolean).join(" · ")}</div>
                        </>
                      ) : (
                        <span className="text-ink-muted">–</span>
                      )}
                    </td>
                    <td>
                      {last ? <Badge tone={state ? DUE_TONE[state] : "neutral"}>{date(last.nextDue)}</Badge> : <Badge tone="danger">{t("fleet.neverChecked")}</Badge>}
                    </td>
                    {canEdit ? (
                      <td className="text-right">
                        <LinkButton size="sm" href={`/fleet/licenses?check=${d.id}`}>
                          <ShieldCheck className="size-3.5" aria-hidden /> {t("fleet.checkNow")}
                        </LinkButton>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </Table>
        )}
      </Card>

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
