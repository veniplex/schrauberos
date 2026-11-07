import clsx from "clsx";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { ReactNode } from "react";
import { getI18n } from "@/i18n/server";
import type { SortDir } from "@/lib/list-params";
import { Card } from "./layout";
import { LinkPending } from "./link-pending";
import { ScrollArea } from "./scroll-area";

/**
 * Eine Spalte einer Datenliste.
 * - `header`: Spaltenkopf – in der Kartenansicht die Beschriftung des Wertes.
 * - `priority`: `primary` = Hauptspalte (Name, Kennzeichen): trägt den Zeilenlink und ist in der Kartenansicht der Titel; `normal` = Tabelle und Karte;
 *   `low` = nur in der Tabelle und erst ab `lg` (Nebensächliches).
 * - `sort`: Sortierschlüssel – die Spalte ist sortierbar (Kopf wird zum Link).
 * - `sub`: Nebenzeile unter dem Inhalt der Hauptspalte (Kundennummer, Marken) – steht außerhalb des Zeilenlinks, damit dessen Name kurz bleibt.
 * - `align="end"`: Zahlen rechtsbündig. `hideHeader`: kein sichtbarer Kopf (Aktionsspalte), der Name bleibt für Hilfstechnik; in der Kartenansicht stehen diese Zellen als Aktionsleiste unter der Karte.
 */
export type DataColumn<R> = {
  id: string;
  header: ReactNode;
  cell: (row: R) => ReactNode;
  sub?: (row: R) => ReactNode;
  priority?: "primary" | "normal" | "low";
  sort?: string;
  align?: "end";
  className?: string;
  hideHeader?: boolean;
};

const LOW = "max-lg:hidden";

/**
 * **Die** Datenliste der Anwendung (alle Listen nutzen sie): eine Beschreibung der Spalten, zwei Darstellungen.
 * - Ab `md` eine Tabelle: `caption` benennt sie (unsichtbar), der Scroll-Rahmen ist per Tastatur erreichbar und zeigt an, dass es weitergeht; sortierbare Spalten sind Links
 *   (`aria-sort`); mit `rowHref` ist die **ganze Zeile** ein Link (Hauptspalte mit gestrecktem Link – ein weiterer Link oder Knopf in einer Zelle liegt darüber und bleibt bedienbar).
 * - Darunter Karten: je Zeile eine Karte mit dem Titel (Hauptspalte) und den Werten mit Beschriftung; die Sortierung steht dann als Chipreihe darüber.
 * - `summary` (Anzahl, „angezeigt werden …“) steht über der Liste, `footer` (die Seitenwahl `Pagination`) darunter; `empty` ersetzt die Liste, wenn es keine Zeilen gibt.
 * Zellen liefern nur Inhalt; Zeilenlinks gehören an `rowHref`, nicht in die Hauptzelle.
 */
export async function DataTable<R>({
  caption,
  columns,
  rows,
  rowKey,
  rowHref,
  sort,
  sortHref,
  minWidth = "40rem",
  summary,
  footer,
  empty,
  className,
}: {
  caption: string;
  columns: Array<DataColumn<R>>;
  rows: R[];
  rowKey: (row: R) => string;
  rowHref?: (row: R) => string | null;
  sort?: { key: string; dir: SortDir };
  sortHref?: (key: string, dir: SortDir) => string;
  minWidth?: string;
  summary?: ReactNode;
  footer?: ReactNode;
  empty?: ReactNode;
  className?: string;
}) {
  const { t } = await getI18n();
  const primary = columns.find((c) => c.priority === "primary") ?? columns[0];
  const cardColumns = columns.filter((c) => c !== primary && c.priority !== "low" && !c.hideHeader);
  const cardActions = columns.filter((c) => c !== primary && c.hideHeader);
  const sortable = sortHref ? columns.filter((c) => c.sort) : [];
  const nextDir = (c: DataColumn<R>): SortDir => (sort !== undefined && sort.key === c.sort && sort.dir === "asc" ? "desc" : "asc");

  if (rows.length === 0 && empty) {
    return (
      <Card padded={false} className={clsx("overflow-hidden", className)}>
        {empty}
      </Card>
    );
  }

  return (
    <Card as="div" padded={false} className={clsx("overflow-hidden", className)}>
      {summary ? <p className="border-b border-line px-4 py-2 text-sm text-ink-muted">{summary}</p> : null}

      {/* Karten (unter md) */}
      <div className="md:hidden">
        {sortable.length > 0 ? (
          <nav aria-label={t("common.sortBy")} className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2">
            <span className="text-xs text-ink-muted">{t("common.sortBy")}</span>
            {sortable.map((c) => {
              const active = sort?.key === c.sort;
              return (
                <Link
                  key={c.id}
                  href={sortHref!(c.sort!, nextDir(c))}
                  aria-current={active ? "true" : undefined}
                  className={clsx("badge relative min-h-(--tap-chip) gap-1 px-3 py-1 text-sm", active ? "badge-accent" : "badge-neutral hover:bg-surface-hover")}
                >
                  {c.header}
                  {active ? sort!.dir === "asc" ? <ArrowUp className="size-3.5" aria-hidden /> : <ArrowDown className="size-3.5" aria-hidden /> : null}
                  <LinkPending className="absolute right-0.5 top-1/2 size-3 -translate-y-1/2" />
                </Link>
              );
            })}
          </nav>
        ) : null}
        <ul className="divide-y divide-line">
          {rows.map((row) => {
            const href = rowHref?.(row) ?? null;
            return (
              <li key={rowKey(row)} className={clsx("relative px-4 py-3", href && "hover:bg-surface-hover")}>
                <div className="min-w-0 font-medium">
                  {href ? (
                    <Link href={href} className="after:absolute after:inset-0">
                      {primary.cell(row)}
                    </Link>
                  ) : (
                    primary.cell(row)
                  )}
                </div>
                {primary.sub ? <div className="mt-0.5 text-xs text-ink-muted [&_a]:relative [&_a]:z-10">{primary.sub(row)}</div> : null}
                {cardColumns.length > 0 ? (
                  <dl className="mt-1.5 grid gap-x-4 gap-y-1 text-sm [&_a]:relative [&_a]:z-10 [&_button]:relative [&_button]:z-10">
                    {cardColumns.map((c) => (
                      <div key={c.id} className="flex min-w-0 items-baseline gap-2">
                        <dt className="w-28 shrink-0 text-xs text-ink-muted">{c.header}</dt>
                        <dd className={clsx("min-w-0 flex-1 break-words", c.align === "end" && "tabular", c.className)}>{c.cell(row)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {cardActions.length > 0 ? (
                  <div className="relative z-10 mt-2 flex flex-wrap items-center justify-end gap-2">
                    {cardActions.map((c) => (
                      <div key={c.id} className="contents">
                        {c.cell(row)}
                      </div>
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Tabelle (ab md) */}
      <div className="max-md:hidden">
        <ScrollArea label={caption}>
          <table className="table" style={{ minWidth }}>
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr>
                {columns.map((c) => {
                  const active = Boolean(c.sort) && sort?.key === c.sort;
                  const ariaSort = c.sort && sortHref ? (active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none") : undefined;
                  return (
                    <th key={c.id} scope="col" aria-sort={ariaSort} className={clsx(c.align === "end" && "text-right", c.priority === "low" && LOW)}>
                      {c.hideHeader ? (
                        <span className="sr-only">{c.header}</span>
                      ) : c.sort && sortHref ? (
                        <Link
                          href={sortHref(c.sort, nextDir(c))}
                          title={typeof c.header === "string" ? t("common.sortColumn", { column: c.header }) : undefined}
                          className={clsx("relative -mx-1 inline-flex min-h-(--tap-row) items-center gap-1 rounded-sm px-1 uppercase hover:text-ink", c.align === "end" && "flex-row-reverse")}
                        >
                          {c.header}
                          {active ? sort!.dir === "asc" ? <ArrowUp className="size-3.5" aria-hidden /> : <ArrowDown className="size-3.5" aria-hidden /> : <ArrowUpDown className="size-3.5 opacity-50" aria-hidden />}
                          <LinkPending className="absolute -right-3 top-1/2 size-3 -translate-y-1/2" />
                        </Link>
                      ) : (
                        c.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const href = rowHref?.(row) ?? null;
                return (
                  // `relative` am `tr` ist der Bezug des gestreckten Links (`after:absolute` an der Hauptzelle). Mit Playwright in Chromium **und WebKit** geprüft (Klick in jede Zeile trifft ihren
                  // Link, Verweise in anderen Zellen liegen darüber, kein Überlauf): kein zusätzlicher Kniff nötig. Fiele der Bezug je aus, wäre die ganze Tabelle ein Link – dann hier `[transform:translateZ(0)]` ergänzen.
                  <tr key={rowKey(row)} className={clsx("relative", href && "row-link")}>
                    {columns.map((c) => {
                      const main = c === primary;
                      return (
                        <td key={c.id} className={clsx(c.align === "end" && "text-right tabular", c.priority === "low" && LOW, !main && "[&_a]:relative [&_a]:z-10 [&_button]:relative [&_button]:z-10", c.className)}>
                          {main && href ? (
                            <Link href={href} className="inline-flex min-h-(--tap-row) items-center font-medium after:absolute after:inset-0">
                              {c.cell(row)}
                            </Link>
                          ) : (
                            c.cell(row)
                          )}
                          {main && c.sub ? <div className="text-xs font-normal text-ink-muted [&_a]:relative [&_a]:z-10 [&_button]:relative [&_button]:z-10">{c.sub(row)}</div> : null}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollArea>
      </div>
      {footer}
    </Card>
  );
}
