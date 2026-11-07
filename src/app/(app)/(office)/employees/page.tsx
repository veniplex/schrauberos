import type { Metadata } from "next";
import { CalendarOff, Plus } from "lucide-react";
import { Badge, EmptyState } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { FilterBar } from "@/components/ui/filter-bar";
import { LinkButton } from "@/components/ui/buttons";
import { DataTable } from "@/components/ui/data-table";
import { Pagination } from "@/components/ui/pagination";
import type { Prisma } from "@/generated/prisma/client";
import { getI18n } from "@/i18n/server";
import { clampPage, listLinks, pageWindow, parseListParams } from "@/lib/list-params";
import { DEPARTMENTS, employeeName } from "@/modules/office/employees/domain";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { contains, searchWhere } from "@/server/search";
import { SearchInput, Select } from "@/components/ui/form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.employees") };
}

type SearchParams = { q?: string; department?: string; status?: string; sort?: string; dir?: string; page?: string };
const SORTS = ["name", "role"] as const;
const DEFAULT = { sort: "name", dir: "asc" } as const;

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requirePermission("employees.view");
  const [{ t, tp, td }, sp] = await Promise.all([getI18n(), searchParams]);
  const q = (sp.q ?? "").trim();
  const department = (DEPARTMENTS as readonly string[]).includes(sp.department ?? "") ? sp.department! : "";
  const status = sp.status === "all" || sp.status === "inactive" ? sp.status : "active";
  const list = parseListParams(sp, { sorts: SORTS, ...DEFAULT });

  // Durchsuchbar sind nur Felder der Mitarbeiterliste; Notfallkontakt und Abwesenheitsgründe (`employees.sensitive`) gehören nie dazu
  const text = searchWhere<Prisma.EmployeeWhereInput>(q, session.can, [
    { where: (term) => ({ firstName: contains(term) }) },
    { where: (term) => ({ lastName: contains(term) }) },
    { where: (term) => ({ personnelNumber: contains(term) }) },
    { where: (term) => ({ jobTitle: contains(term) }) },
    { where: (term) => ({ email: contains(term) }) },
  ]);
  const where = {
    ...(department ? { department } : {}),
    ...(status === "active" ? { active: true } : status === "inactive" ? { active: false } : {}),
    ...(text ?? {}),
  };
  const total = await db.employee.count({ where });
  const page = clampPage(list.page, total, list.pageSize);
  const orderBy = list.sort === "role" ? [{ department: list.dir }, { jobTitle: list.dir }, { lastName: "asc" as const }] : [{ lastName: list.dir }, { firstName: list.dir }];
  const employees = await db.employee.findMany({ where, include: { user: { select: { id: true, username: true } } }, orderBy, ...pageWindow(page, list.pageSize) });
  const canEdit = session.can("employees.edit");
  const links = listLinks("/employees", { q: q || undefined, department: department || undefined, status: status !== "active" ? status : undefined }, list, DEFAULT);

  return (
    <>
      <PageHeader
        title={t("employees.title")}
        description={t("employees.description")}
        help="office.employees"
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

      <FilterBar
        columns="sm:grid-cols-[minmax(0,1fr)_11rem_10rem_auto]"
        active={Boolean(q || department || status !== "active")}
        extrasOpen={Boolean(department || status !== "active")}
        resetHref="/employees"
        search={<SearchInput name="q" defaultValue={q} placeholder={t("employees.searchPlaceholder")} aria-label={t("common.search")} />}
      >
        <Select name="department" defaultValue={department} aria-label={t("employees.fields.department")}>
          <option value="">{t("employees.filters.anyDepartment")}</option>
          {DEPARTMENTS.map((x) => (
            <option key={x} value={x}>
              {td(`employees.departments.${x}`, x)}
            </option>
          ))}
        </Select>
        <Select name="status" defaultValue={status} aria-label={t("common.status")}>
          <option value="active">{t("employees.filters.active")}</option>
          <option value="inactive">{t("employees.filters.inactive")}</option>
          <option value="all">{t("employees.filters.all")}</option>
        </Select>
      </FilterBar>

      <DataTable
        caption={t("employees.title")}
        rows={employees}
        rowKey={(e) => e.id}
        rowHref={(e) => `/employees/${e.id}`}
        sort={{ key: list.sort, dir: list.dir }}
        sortHref={links.sortHref}
        minWidth="44rem"
        summary={tp("employees.count", total)}
        footer={<Pagination page={page} pageSize={list.pageSize} total={total} hrefFor={links.pageHref} />}
        empty={<EmptyState title={t("employees.empty")} hint={q || department || status !== "active" ? t("common.noResults") : t("employees.emptyHint")} />}
        columns={[
          {
            id: "name",
            header: t("employees.cols.name"),
            priority: "primary",
            sort: "name",
            cell: (e) => employeeName(e),
            sub: (e) =>
              e.personnelNumber || !e.active ? (
                <span className="flex items-center gap-2">
                  {e.personnelNumber ? <span className="tabular">#{e.personnelNumber}</span> : null}
                  {!e.active ? <Badge>{t("employees.inactive")}</Badge> : null}
                </span>
              ) : null,
          },
          {
            id: "role",
            header: t("employees.cols.role"),
            sort: "role",
            cell: (e) => (
              <div className="text-sm">
                {e.jobTitle ?? <span className="text-ink-muted">–</span>}
                <div className="text-xs text-ink-muted">{td(`employees.departments.${e.department}`, e.department)}</div>
              </div>
            ),
          },
          {
            id: "contact",
            header: t("employees.cols.contact"),
            cell: (e) => (
              <div className="text-sm">
                {e.mobile ?? e.phone ?? <span className="text-ink-muted">–</span>}
                {e.email ? <div className="text-xs text-ink-muted">{e.email}</div> : null}
              </div>
            ),
          },
          { id: "account", header: t("employees.cols.account"), cell: (e) => (e.user ? <Badge tone="accent">{e.user.username}</Badge> : <span className="text-ink-muted">–</span>) },
        ]}
      />
    </>
  );
}
