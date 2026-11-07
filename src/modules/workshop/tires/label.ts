import type { Translator } from "@/i18n/translate";
import type { LabelContent } from "@/lib/labels";
import { publicLink } from "@/lib/public-url";
import { formatTireSize } from "./domain";
import type { TireLabelData } from "./queries";

/**
 * Inhalt des **Reifenlager-Etiketts** (F8): Hauptzeile = Kennzeichen, darunter Lagerplatz (das, wonach man am Regal sucht), Größe und Saison, Marke/Modell, Name des Halters und Einlagerungsdatum.
 * Der QR-Code enthält den **Link** zur Seite des Reifensatzes (absolute Adresse aus der Einstellung „Adresse der Anwendung“, nie aus dem Header der Anfrage); die Systemkamera des Handys öffnet ihn
 * im Browser – ein Scanner in der Anwendung gibt es nicht. Ohne eingestellte Adresse bleibt der QR-Code weg (`qr: null`), das Etikett ist sonst vollständig.
 */
export function tireLabelContent(data: TireLabelData, i18n: Pick<Translator, "t" | "td" | "date">, base: string | null): LabelContent {
  const { t, td, date } = i18n;
  const size = formatTireSize(data);
  const make = [data.brand, data.model].filter(Boolean).join(" ");
  const lines = [
    data.storageLocation ? t("tires.label.location", { location: data.storageLocation }) : t("tires.label.noLocation"),
    [size === "–" ? null : size, td(`enums.season.${data.season}`, data.season)].filter(Boolean).join(" · "),
    make,
    data.ownerName ?? "",
    t("tires.label.storedAt", { date: date(data.storedAt, { dateStyle: "medium" }) }),
  ];
  return { title: data.plate, lines, qr: publicLink(base, `/tires/${encodeURIComponent(data.id)}`) };
}
