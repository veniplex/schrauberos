import type { Metadata } from "next";
import Link from "next/link";
import { CalendarOff, Plus, Search } from "lucide-react";
import { Badge, EmptyState, PageHeader } from "@/components/ui/layout";
import { LinkButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
import { DEPARTMENTS, employeeName } from "@/lib/domain/employees";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { contains } from "@/server/search";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.employees") };
}

type SearchParams = { q?: string; department?: string; status?: string };

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requirePermission("employees.view");
  const [{ t, tp, td }, sp] = await Promise.all([getI18n(), searchParams]);
  const q = (sp.q ?? "").trim();
  const department = (DEPARTMENTS as readonly string[]).includes(sp.department ?? "") ? sp.department! : "";
  const status = sp.status === "all" || sp.status === "inactive" ? sp.status : "active";

  const employees = await db.employee.findMany({
    where: {
      ...(department ? { department } : {}),
      ...(status === "active" ? { active: true } : status === "inactive" ? { active: false } : {}),
      ...(q ? { OR: [{ firstName: contains(q) }, { lastName: contains(q) }, { personnelNumber: contains(q) }, { jobTitle: contains(q) }, { email: contains(q) }] } : {}),
    },
    include: { user: { select: { id: true, username: true } } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  const canEdit = session.can("employees.edit");

  return (
    <>
      <PageHeader
        title={t("employees.title")}
        description={t("employees.description")}
        actions={
          <>
            <LinkButton href="/employees/absences">
              <CalendarOff className="size-4" aria-hidden /> {t("nav.absences")}
            </LinkButton>
            {canEdit ? (
              <LinkButton href="/employees/new" variant="primary">
                <Plus className="size-4" aria-hidden /> {t("employees.new")}
              </LinkButton>
            ) : null}
          </>
        }
      />

      <form method="get" className="card card-pad mb-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem_10rem_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
          <input name="q" defaultValue={q} className="input pl-9" placeholder={t("employees.searchPlaceholder")} aria-label={t("common.search")} />
        </div>
        <select name="department" defaultValue={department} className="input" aria-label={t("employees.fields.department")}>
          <option value="">{t("employees.filters.anyDepartment")}</option>
          {DEPARTMENTS.map((x) => (
            <option key={x} value={x}>
              {td(`employees.departments.${x}`, x)}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={status} className="input" aria-label={t("common.status")}>
          <option value="active">{t("employees.filters.active")}</option>
          <option value="inactive">{t("employees.filters.inactive")}</option>
          <option value="all">{t("employees.filters.all")}</option>
        </select>
        <button type="submit" className="btn btn-secondary">
          {t("common.filter")}
        </button>
      </form>

      <section className="card overflow-hidden">
        {employees.length === 0 ? (
          <EmptyState title={t("employees.empty")} hint={t("employees.emptyHint")} />
        ) : (
          <>
            <p className="border-b border-line px-4 py-2 text-sm text-ink-muted">{tp("employees.count", employees.length)}</p>
            <div className="overflow-x-auto">
              <table className="table min-w-[44rem]">
                <thead>
                  <tr>
                    <th>{t("employees.cols.name")}</th>
                    <th>{t("employees.cols.role")}</th>
                    <th>{t("employees.cols.contact")}</th>
                    <th>{t("employees.cols.account")}</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((e) => (
                    <tr key={e.id} className="row-link">
                      <td>
                        <Link href={`/employees/${e.id}`} className="font-medium hover:underline">
                          {employeeName(e)}
                        </Link>
                        <div className="flex items-center gap-2 text-xs text-ink-muted">
                          {e.personnelNumber ? <span className="tabular">#{e.personnelNumber}</span> : null}
                          {!e.active ? <Badge>{t("employees.inactive")}</Badge> : null}
                        </div>
                      </td>
                      <td className="text-sm">
                        {e.jobTitle ?? <span className="text-ink-muted">–</span>}
                        <div className="text-xs text-ink-muted">{td(`employees.departments.${e.department}`, e.department)}</div>
                      </td>
                      <td className="text-sm">
                        {e.mobile ?? e.phone ?? <span className="text-ink-muted">–</span>}
                        {e.email ? <div className="text-xs text-ink-muted">{e.email}</div> : null}
                      </td>
                      <td>{e.user ? <Badge tone="accent">{e.user.username}</Badge> : <span className="text-ink-muted">–</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </>
  );
}
