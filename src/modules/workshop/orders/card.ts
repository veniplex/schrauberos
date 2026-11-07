import type { Translator } from "@/i18n/translate";
import { QUANTITY_DECIMALS, scaledToInput } from "@/lib/line-items";
import { publicLink } from "@/lib/public-url";
import type { CardModel } from "@/lib/print-card";
import type { OrderCardData } from "./queries";

/**
 * Das Modell der **Auftragskarte** (F8, Werkstattlaufzettel): Auftrag, Fahrzeug, Kunde (Anzeigename, das Telefon nur, wenn die Abfrage es geliefert hat), Kundenwunsch, die Positionen **ohne Preise**, Zeilen
 * anderer Funktionen (Annahmeprotokoll), Schreiblinien für Notizen und ein QR-Code mit dem Link zur Auftragsseite (Adresse aus der Einstellung, ohne sie kein QR). PDF und Druckansicht zeichnen dasselbe
 * Modell (`server/pdf/card.ts`, `components/ui/print-card.tsx`).
 */
export type WorkshopHead = { name: string; street: string | null; zip: string | null; city: string | null; phone: string | null };

const join = (parts: Array<string | null | undefined>, separator: string) => parts.filter((p): p is string => !!p && p.trim() !== "").join(separator);

export function orderCardModel(
  data: OrderCardData,
  context: { i18n: Pick<Translator, "t" | "td" | "date" | "number" | "locale">; workshop: WorkshopHead; base: string | null; extras: ReadonlyArray<readonly [string, string]> },
): CardModel {
  const { t, td, date, locale, number } = context.i18n;
  const lang = locale === "en" ? "en" : "de";
  const facts: Array<readonly [string, string]> = [
    [t("orders.card.order"), data.number],
    [t("orders.card.status"), td(`orders.status.${data.status}`, data.status)],
    [t("orders.card.accepted"), date(data.acceptedAt, { dateStyle: "medium", timeStyle: "short" })],
    [t("orders.card.plate"), data.plate],
  ];
  if (data.vehicleName) facts.push([t("orders.card.vehicle"), data.vehicleName]);
  if (data.mileageKm != null) facts.push([t("orders.card.mileage"), `${number(data.mileageKm)} km`]);
  facts.push([t("orders.card.customer"), data.customerName ?? t("orders.noCustomer")]);
  if (data.phone) facts.push([t("orders.card.phone"), data.phone]);

  const link = publicLink(context.base, `/orders/${encodeURIComponent(data.id)}`);
  return {
    documentTitle: t("orders.card.documentTitle", { number: data.number }),
    subtitle: join([context.workshop.name, join([context.workshop.street, join([context.workshop.zip, context.workshop.city], " ")], ", "), context.workshop.phone], " · "),
    title: t("orders.card.title", { number: data.number }),
    facts,
    blocks: data.request?.trim() ? [{ heading: t("orders.card.request"), text: data.request.trim() }] : [],
    table: {
      heading: t("orders.card.items"),
      columns: [
        { header: t("orders.card.colPos"), weight: 0.6 },
        { header: t("orders.card.colKind"), weight: 1.1 },
        { header: t("orders.card.colText"), weight: 4.2 },
        { header: t("orders.card.colQty"), weight: 1.4, align: "right" },
        { header: t("orders.card.colDone"), weight: 0.9, align: "center" },
      ],
      rows: data.items.map((item, index) => [String(index + 1), td(`orders.kinds.${item.kind}`, item.kind), item.description, join([scaledToInput(item.quantityMilli, QUANTITY_DECIMALS, lang), item.unit], " "), "[   ]"]),
      empty: t("orders.card.noItems"),
    },
    extras: context.extras,
    notes: { heading: t("orders.card.notes"), lines: 8 },
    qr: link ? { data: link, caption: t("orders.card.qr") } : null,
    footer: t("orders.card.footer"),
    pageLabel: (page, total) => t("orders.card.page", { page, total }),
  };
}
