import type { Metadata } from "next";
import { DataTable } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { SearchInput, Select } from "@/components/ui/form";
import { Badge, EmptyState, Plate } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { getI18n } from "@/i18n/server";
import { splitBytes } from "@/lib/bytes";
import { clampPage, listLinks, pageWindow, parseListParams } from "@/lib/list-params";
import { FILE_CATEGORIES } from "@/modules/workshop/files/constants";
import { listFiles } from "@/modules/workshop/files/queries";
import { requirePermission } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.files") };
}

const DEFAULT = { sort: "created", dir: "desc" } as const;

/**
 * Übersicht aller Dokumente und Fotos, die die Person sehen darf (Fahrzeuge nur mit `vehicles.view`, Aufträge nur mit `orders.view`, ohne Kunden mit eingeschränkter Verarbeitung). Jede Zeile führt zum
 * Fahrzeug bzw. Auftrag, an dem die Datei hängt – dort lässt sie sich beschriften und entfernen.
 */
export default async function FilesPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string; type?: string; page?: string; sort?: string; dir?: string }> }) {
  const session = await requirePermission("files.view");
  const [{ t, tp, td, date, number }, sp] = await Promise.all([getI18n(), searchParams]);
  const q = (sp.q ?? "").trim();
  const category = (FILE_CATEGORIES as readonly string[]).includes(sp.category ?? "") ? sp.category : undefined;
  const ownerType: "vehicle" | "order" | undefined = sp.type === "vehicle" || sp.type === "order" ? sp.type : undefined;
  const list = parseListParams(sp, { sorts: ["created"] as const, ...DEFAULT });
  const filters = { q, category, ownerType };
  const first = await listFiles(session, filters, { skip: 0, take: 1 });
  const page = clampPage(list.page, first.total, list.pageSize);
  const { rows, total } = await listFiles(session, filters, pageWindow(page, list.pageSize));
  const links = listLinks("/files", { q: q || undefined, category, type: ownerType }, list, DEFAULT);
  const size = (bytes: number) => {
    const { value, unit } = splitBytes(bytes);
    return `${number(value, { maximumFractionDigits: unit === "B" || unit === "KB" ? 0 : 1 })} ${unit}`;
  };

  return (
    <>
      <PageHeader title={t("files.title")} description={t("files.description")} help="workshop.files" />
      <FilterBar
        columns="sm:grid-cols-[minmax(0,1fr)_12rem_12rem_auto]"
        active={Boolean(q || category || ownerType)}
        resetHref="/files"
        search={<SearchInput name="q" defaultValue={q} placeholder={t("files.searchPlaceholder")} aria-label={t("common.search")} />}
      >
        <Select name="category" defaultValue={category ?? ""} aria-label={t("files.category")}>
          <option value="">{t("files.allCategories")}</option>
          {FILE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {td(`files.categories.${c}`, c)}
            </option>
          ))}
        </Select>
        <Select name="type" defaultValue={ownerType ?? ""} aria-label={t("files.attachedTo")}>
          <option value="">{t("files.allOwners")}</option>
          <option value="vehicle">{t("files.owners.vehicle")}</option>
          <option value="order">{t("files.owners.order")}</option>
        </Select>
      </FilterBar>

      <DataTable
        caption={t("files.title")}
        rows={rows}
        rowKey={(f) => f.id}
        rowHref={(f) => (f.ownerType === "vehicle" ? `/vehicles/${f.ownerId}` : `/orders/${f.ownerId}`)}
        minWidth="46rem"
        summary={tp("files.count", total)}
        footer={<Pagination page={page} pageSize={list.pageSize} total={total} hrefFor={links.pageHref} />}
        empty={<EmptyState title={t("files.listEmpty")} hint={q || category || ownerType ? t("common.noResults") : t("files.listEmptyHint")} />}
        columns={[
          {
            id: "file",
            header: t("files.cols.file"),
            priority: "primary",
            cell: (f) => <span className="break-all font-medium">{f.caption || f.name}</span>,
            sub: (f) => (f.caption ? f.name : null),
          },
          {
            id: "owner",
            header: t("files.cols.owner"),
            cell: (f) => (f.ownerType === "vehicle" ? <Plate>{f.ownerLabel}</Plate> : <span className="tabular">{f.ownerLabel}</span>),
            sub: (f) => t(`files.owners.${f.ownerType}`),
          },
          { id: "category", header: t("files.cols.category"), cell: (f) => <Badge>{td(`files.categories.${f.category}`, f.category)}</Badge> },
          { id: "size", header: t("files.cols.size"), align: "end", priority: "low", cell: (f) => <span className="tabular">{size(f.size)}</span> },
          { id: "by", header: t("files.cols.by"), priority: "low", cell: (f) => f.uploadedByName, sub: (f) => date(f.createdAt, { dateStyle: "medium" }) },
        ]}
      />
    </>
  );
}
