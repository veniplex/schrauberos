import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { Input, Select } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
import { AUDIT_GROUPS } from "@/lib/audit-actions";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { contains } from "@/server/search";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("audit.title") };
}

const PAGE_SIZE = 50;

type SearchParams = { q?: string; group?: string; page?: string };

export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("audit.view");
  const [{ t, tp, td, date }, sp] = await Promise.all([getI18n(), searchParams]);
  const q = (sp.q ?? "").trim().slice(0, 80);
  const group = AUDIT_GROUPS.includes(sp.group ?? "") ? sp.group! : "";
  const requested = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const where = {
    ...(group ? { action: { startsWith: `${group}.` } } : {}),
    ...(q ? { OR: [{ actorName: contains(q) }, { target: contains(q) }] } : {}),
  };
  const total = await db.auditLog.count({ where });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requested, pages);
  const entries = await db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE });

  const href = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (group) params.set("group", group);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/admin/audit?${qs}` : "/admin/audit";
  };

  return (
    <>
      <PageHeader title={t("audit.title")} description={t("audit.description")} />

      <form className="mb-4 flex flex-wrap items-center gap-3" role="search">
        <Input name="q" defaultValue={q} placeholder={t("audit.searchPlaceholder")} aria-label={t("audit.searchPlaceholder")} className="min-w-56 flex-1 sm:max-w-sm" />
        <Select name="group" defaultValue={group} aria-label={t("audit.cols.action")} className="w-56">
          <option value="">{t("audit.allActions")}</option>
          {AUDIT_GROUPS.map((g) => (
            <option key={g} value={g}>
              {td(`audit.groups.${g}`, g)}
            </option>
          ))}
        </Select>
        <SubmitButton variant="secondary">{t("common.search")}</SubmitButton>
      </form>

      <div className="card overflow-hidden">
        {entries.length === 0 ? (
          <EmptyState title={t("audit.empty")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table min-w-[44rem]">
              <thead>
                <tr>
                  <th>{t("audit.cols.time")}</th>
                  <th>{t("audit.cols.actor")}</th>
                  <th>{t("audit.cols.action")}</th>
                  <th>{t("audit.cols.target")}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="tabular whitespace-nowrap">{date(e.createdAt, { dateStyle: "short", timeStyle: "medium" })}</td>
                    <td>{e.actorName}</td>
                    <td>{td(`audit.actions.${e.action}`, e.action)}</td>
                    <td className="text-ink-muted">{e.target ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-ink-muted">
        <span>{tp("audit.count", total)}</span>
        {pages > 1 ? (
          <nav className="flex items-center gap-3" aria-label={t("audit.page", { page, pages })}>
            {page > 1 ? (
              <Link href={href(page - 1)} className="hover:text-ink">
                ‹
              </Link>
            ) : null}
            <span>{t("audit.page", { page, pages })}</span>
            {page < pages ? (
              <Link href={href(page + 1)} className="hover:text-ink">
                ›
              </Link>
            ) : null}
          </nav>
        ) : null}
      </div>
    </>
  );
}
