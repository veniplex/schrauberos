import type { Metadata } from "next";
import { LinkButton } from "@/components/ui/buttons";
import { Plate, Table } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { nowDate } from "@/lib/dates";
import { isMonth, monthStart } from "@/lib/month";
import { customerContacts, customerDisplayName, customerNameSelect } from "@/modules/workshop/customers/public";
import { monthOf } from "@/modules/workshop/vehicles/domain";
import { PrintButton } from "@/modules/workshop/vehicles/print-button";
import { vehicleListWhere } from "@/modules/workshop/vehicles/queries";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vehicles.print.title") };
}

/** So viele Fahrzeuge druckt die Liste höchstens (eine Anrufliste, kein Gesamtexport – der CSV-Export kommt gesondert). */
const MAX_ROWS = 1000;

/**
 * Druckliste der Fahrzeugliste (gleiche Filter): Kennzeichen, Fahrzeug, Halter, Telefon, Prüffrist – zum Abhaken beim Anrufen („HU fällig im Monat X“). Das Telefon des Halters
 * sieht nur, wer Kunden sehen darf (Richtlinie D7). Am Bildschirm mit „Drucken“, im Ausdruck nur Titel, Filter und Tabelle.
 */
export default async function VehiclesPrintPage({ searchParams }: { searchParams: Promise<{ q?: string; owner?: string; inspection?: string; month?: string }> }) {
  const session = await requirePermission("vehicles.view");
  const [{ t, tp, td, date, number }, sp] = await Promise.all([getI18n(), searchParams]);
  const q = (sp.q ?? "").trim();
  const noOwnerOnly = sp.owner === "none";
  const inspection = sp.inspection === "soon" || sp.inspection === "none" ? sp.inspection : undefined;
  const month = sp.month && isMonth(sp.month) ? sp.month : undefined;
  const thisMonth = monthOf(nowDate());
  const where = vehicleListWhere({ q, noOwnerOnly, inspection, month }, session.can, thisMonth);

  const [total, found] = await Promise.all([
    db.vehicle.count({ where }),
    db.vehicle.findMany({ where, include: { customer: { select: customerNameSelect } }, orderBy: [{ inspectionDue: "asc" }, { plateNorm: "asc" }], take: MAX_ROWS }),
  ]);
  // Fahrzeuge ohne Frist ans Ende (SQLite sortiert leere Werte aufsteigend nach vorn)
  const vehicles = [...found.filter((v) => v.inspectionDue), ...found.filter((v) => !v.inspectionDue)];
  // Telefon nur mit `customers.view` (D7); sonst wird er gar nicht gelesen
  const canSeePhone = session.can("customers.view");
  const contacts = await customerContacts(session, found.flatMap((v) => (v.customerId ? [v.customerId] : [])));
  const monthLabel = (value: string) => date(monthStart(value), { month: "long", year: "numeric" });
  const filterText = [
    month ? t("vehicles.print.filterMonth", { month: monthLabel(month) }) : inspection === "soon" ? t("vehicles.print.filterSoon") : inspection === "none" ? t("vehicles.print.filterNone") : t("vehicles.print.filterAll"),
    noOwnerOnly ? t("vehicles.filters.noOwner") : null,
    q ? t("vehicles.print.filterText", { q }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <div className="print:hidden">
        <PageHeader back={{ href: "/vehicles", label: t("vehicles.print.back") }} help="workshop.vehicles" title={t("vehicles.print.title")} description={t("vehicles.print.filter", { filter: filterText })} actions={<PrintButton />} />
        {!canSeePhone ? <p className="mb-3 text-sm text-ink-muted">{t("vehicles.print.noPhone")}</p> : null}
        {total > MAX_ROWS ? <p className="mb-3 text-sm text-warning-ink">{t("vehicles.print.truncated", { max: MAX_ROWS })}</p> : null}
      </div>
      <section aria-label={t("vehicles.print.title")}>
        <div className="mb-3 hidden print:block">
          <h1 className="text-xl font-semibold">{t("vehicles.print.title")}</h1>
          <p className="text-sm">
            {t("vehicles.print.filter", { filter: filterText })} · {tp("vehicles.print.count", total)} · {t("vehicles.print.printedOn", { date: date(nowDate(), { dateStyle: "medium" }) })}
          </p>
        </div>
        <Table caption={t("vehicles.print.title")} className="min-w-[44rem] text-sm print:text-xs">
          <thead>
            <tr>
              <th>{t("vehicles.print.cols.plate")}</th>
              <th>{t("vehicles.print.cols.vehicle")}</th>
              <th>{t("vehicles.print.cols.owner")}</th>
              {canSeePhone ? <th>{t("vehicles.print.cols.phone")}</th> : null}
              <th>{t("vehicles.print.cols.due")}</th>
              <th>{t("vehicles.print.cols.mileage")}</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.map((v) => (
              <tr key={v.id} className="break-inside-avoid">
                <td>
                  <Plate>{v.plate}</Plate>
                </td>
                <td>{[v.make, v.model].filter(Boolean).join(" ") || "–"}</td>
                <td>{customerDisplayName(v.customer)}</td>
                {canSeePhone ? <td className="tabular whitespace-nowrap">{contacts.get(v.customerId ?? "")?.phone ?? "–"}</td> : null}
                <td>
                  <div className="tabular">{v.inspectionDue ? monthLabel(v.inspectionDue) : "–"}</div>
                  {v.extraInspectionKind && v.extraInspectionDue ? (
                    <div className="text-xs text-ink-muted">
                      {td(`vehicles.extraKinds.${v.extraInspectionKind}`, v.extraInspectionKind)}: {date(v.extraInspectionDue)}
                    </div>
                  ) : null}
                </td>
                <td className="tabular text-right">{v.mileageKm != null ? number(v.mileageKm) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        {vehicles.length === 0 ? <p className="mt-3 text-sm text-ink-muted">{t("common.noResults")}</p> : null}
      </section>
      <div className="mt-4 print:hidden">
        <LinkButton href="/vehicles" variant="ghost">
          {t("vehicles.print.back")}
        </LinkButton>
      </div>
    </>
  );
}
