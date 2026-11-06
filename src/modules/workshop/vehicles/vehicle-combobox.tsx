"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { Plate } from "@/components/ui/layout";
import { Button } from "@/components/ui/buttons";
import { SearchInput } from "@/components/ui/form";

export type VehicleOption = { id: string; plate: string; description: string; customer: string };

/**
 * Suchfeld für Fahrzeuge (Kennzeichen / Kunde / Modell). Schreibt die Auswahl in ein verstecktes
 * Formularfeld `name`. `initial` zeigt eine vorbelegte Auswahl an.
 */
export function VehicleCombobox({
  name = "vehicleId",
  initial,
  invalid,
  required,
}: {
  name?: string;
  initial?: VehicleOption | null;
  invalid?: boolean;
  required?: boolean;
}) {
  const { t } = useI18n();
  const listId = useId();
  const [selected, setSelected] = useState<VehicleOption | null>(initial ?? null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VehicleOption[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const handle = setTimeout(async () => {
      abort.current?.abort();
      const controller = (abort.current = new AbortController());
      try {
        const res = await fetch(`/api/vehicles/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (!res.ok) return;
        const data = (await res.json()) as { results: VehicleOption[] };
        setResults(data.results);
        setActive(0);
        setOpen(true);
      } catch {
        /* abgebrochen */
      }
    }, 180);
    return () => clearTimeout(handle);
  }, [query]);

  // Ergebnisse nur zum aktuellen Suchtext anzeigen (leerer Text -> keine Liste)
  const visible = query.trim() ? results : [];

  function choose(option: VehicleOption) {
    setSelected(option);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-line-strong bg-surface-2 px-3 py-1.5">
        <input type="hidden" name={name} value={selected.id} />
        <div className="flex min-w-0 items-center gap-2">
          <Plate>{selected.plate}</Plate>
          <span className="truncate text-sm">
            {[selected.description, selected.customer].filter(Boolean).join(" · ")}
          </span>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label={t("common.remove")} onClick={() => setSelected(null)}>
          <X className="size-4" aria-hidden />
        </Button>
      </div>
    );
  }

  return (
    <div className="relative">
      <SearchInput
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        placeholder={t("vehicles.searchPlaceholder")}
        value={query}
        required={required}
        autoComplete="off"
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => visible.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, visible.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && open && visible[active]) {
            e.preventDefault();
            choose(visible[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open ? (
        <ul id={listId} role="listbox" className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-line bg-surface p-1 shadow-pop">
          {visible.length === 0 ? (
            <li className="px-3 py-2 text-sm text-ink-muted">{t("common.noResults")}</li>
          ) : (
            visible.map((r, i) => (
              <li
                key={r.id}
                role="option"
                aria-selected={i === active}
                className={`flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm ${i === active ? "bg-surface-hover" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(r);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <Plate>{r.plate}</Plate>
                <span className="truncate">{[r.description, r.customer].filter(Boolean).join(" · ")}</span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
