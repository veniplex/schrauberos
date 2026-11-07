"use client";

import { Plate } from "@/components/ui/layout";
import { SearchCombobox, type SearchOption } from "@/components/ui/search-combobox";
import { useI18n } from "@/i18n/client";

/** Fahrzeug als Auswahlwert: Kennzeichen als Beschriftung, Fahrzeug und Halter als Zusatz (Antwort von `/api/vehicles/search`). */
export type VehicleOption = SearchOption & { plate: string; description: string; customer: string };

/**
 * Auswahlfeld für Fahrzeuge (Kennzeichen / Kunde / Modell): der allgemeine `SearchCombobox` mit Kennzeichen-Plakette. Schreibt die Auswahl in das versteckte Feld `name`.
 * `canCreate`: bei keinem Treffer „Fahrzeug neu anlegen“ anbieten (mit dem Suchtext als Kennzeichen).
 */
export function VehiclePicker({
  name = "vehicleId",
  initial,
  invalid,
  required,
  canCreate,
}: {
  name?: string;
  initial?: VehicleOption | null;
  invalid?: boolean;
  required?: boolean;
  canCreate?: boolean;
}) {
  const { t } = useI18n();
  return (
    <SearchCombobox<VehicleOption>
      endpoint="/api/vehicles/search"
      name={name}
      initial={initial}
      placeholder={t("vehicles.searchPlaceholder")}
      invalid={invalid}
      required={required}
      createHref={canCreate ? "/vehicles/new" : undefined}
      createLabel={t("vehicles.createNew")}
      createParam="plate"
      renderOption={(o) => (
        <span className="flex min-w-0 items-center gap-2">
          <Plate>{o.plate}</Plate>
          <span className="truncate">{o.sublabel}</span>
        </span>
      )}
      renderSelected={(o) => (
        <span className="flex min-w-0 items-center gap-2">
          <Plate>{o.plate}</Plate>
          <span className="truncate">{o.sublabel}</span>
        </span>
      )}
    />
  );
}
