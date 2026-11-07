"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { Button } from "./buttons";
import { useField } from "./form-context";
import { TextLink } from "./layout";

export type SearchOption = { id: string; label: string; sublabel?: string };

type Status = "idle" | "done" | "error";

/**
 * Suchfeld mit Ergebnisliste (Combobox nach dem ARIA-Muster mit `aria-activedescendant`). Fragt `endpoint?q=…` ab (Antwort `{ results: SearchOption[] }`) und schreibt die
 * Auswahl in ein verstecktes Feld `name`. Ohne Auswahl wird nichts gesendet.
 *
 * - **Tastatur:** Pfeil auf/ab wählt (der Fokus bleibt im Feld, die gewählte Option steht in `aria-activedescendant`), Enter übernimmt, Escape schließt, Tab verlässt das Feld.
 * - **Screenreader:** Die Anzahl der Treffer (oder „Keine Treffer“, oder der Ladefehler) wird in einer Live-Region angesagt.
 * - **Ladefehler** („Die Suche ist gerade nicht möglich“) statt stummem Nichts.
 * - **Keine Treffer:** mit `createHref` bietet die Liste „… neu anlegen“ an (der Suchtext geht als `?<createParam>=` mit).
 * - **Eigene Darstellung:** `renderOption`/`renderSelected` (z. B. Kennzeichen-Plakette für Fahrzeuge) – der Baustein bleibt derselbe.
 * - Id, Beschriftung und Fehlerzustand kommen vom umgebenden `Field`. Zeilen sind bei Touch mindestens 44 px hoch.
 */
export function SearchCombobox<T extends SearchOption = SearchOption>({
  endpoint,
  name,
  initial,
  placeholder,
  invalid,
  required,
  renderOption,
  renderSelected,
  createHref,
  createLabel,
  createParam = "q",
}: {
  endpoint: string;
  name: string;
  initial?: T | null;
  placeholder: string;
  invalid?: boolean;
  required?: boolean;
  renderOption?: (option: T) => ReactNode;
  renderSelected?: (option: T) => ReactNode;
  /** Ziel von „neu anlegen“ bei keinem Treffer (Funktion bringt ihr Anlegen-Formular mit) */
  createHref?: string;
  createLabel?: string;
  createParam?: string;
}) {
  const { t, tp } = useI18n();
  const field = useField();
  const listId = useId();
  const [selected, setSelected] = useState<T | null>(initial ?? null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<T[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const refocus = useRef(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const handle = setTimeout(async () => {
      abort.current?.abort();
      const controller = (abort.current = new AbortController());
      try {
        const res = await fetch(`${endpoint}?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { results: T[] };
        setResults(data.results);
        setStatus("done");
      } catch {
        if (controller.signal.aborted) return; // von einer neueren Suche abgelöst
        setResults([]);
        setStatus("error");
      }
      setActive(0);
      setOpen(true);
    }, 180);
    return () => clearTimeout(handle);
  }, [query, endpoint]);

  // Nach „Entfernen“ zurück ins Suchfeld (sonst ginge der Fokus mit dem Knopf verloren)
  useEffect(() => {
    if (!selected && refocus.current) {
      refocus.current = false;
      input.current?.focus();
    }
  }, [selected]);

  // Ergebnisse nur zum aktuellen Suchtext anzeigen (leerer Text → keine Liste)
  const searching = query.trim() !== "";
  const visible = searching ? results : [];
  const showPopup = open && searching && status !== "idle";
  const hasList = showPopup && visible.length > 0;
  const optionId = (index: number) => `${listId}-option-${index}`;
  const announcement = !showPopup ? "" : status === "error" ? t("common.searchUnavailable") : visible.length === 0 ? t("common.noResults") : tp("common.resultsCount", visible.length);

  function choose(option: T) {
    setSelected(option);
    setQuery("");
    setResults([]);
    setStatus("idle");
    setOpen(false);
  }

  if (selected) {
    return (
      <div role="group" aria-labelledby={field?.labelId} aria-describedby={field?.describedBy} className="flex items-center justify-between gap-3 rounded-md border border-line-strong bg-surface-2 px-3 py-1.5">
        <input type="hidden" name={name} value={selected.id} />
        {renderSelected ? (
          <div className="min-w-0 text-sm">{renderSelected(selected)}</div>
        ) : (
          <div className="min-w-0 text-sm">
            <span className="font-medium">{selected.label}</span>
            {selected.sublabel ? <span className="ml-2 text-ink-muted">{selected.sublabel}</span> : null}
          </div>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`${t("common.remove")}: ${selected.label}`}
          onClick={() => {
            refocus.current = true;
            setSelected(null);
          }}
        >
          <X className="size-4" aria-hidden />
        </Button>
      </div>
    );
  }

  return (
    <div
      className="relative"
      onBlur={(event) => {
        // der Fokus verlässt das Feld samt Liste (nicht: er wandert nur zu „neu anlegen“)
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
      <input
        ref={input}
        id={field?.id}
        type="text"
        className="input pl-9"
        role="combobox"
        aria-expanded={hasList}
        aria-controls={hasList ? listId : undefined}
        aria-activedescendant={hasList && visible[active] ? optionId(active) : undefined}
        aria-autocomplete="list"
        aria-invalid={(invalid ?? field?.invalid) || undefined}
        aria-required={required || field?.required || undefined}
        aria-describedby={field?.describedBy}
        placeholder={placeholder}
        value={query}
        required={required}
        autoComplete="off"
        enterKeyHint="search"
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => visible.length && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, visible.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && hasList && visible[active]) {
            e.preventDefault();
            choose(visible[active]);
          } else if (e.key === "Escape" && showPopup) {
            e.preventDefault();
            e.stopPropagation(); // schließt nur die Liste, nicht den Dialog dahinter
            setOpen(false);
          }
        }}
      />
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {showPopup ? (
        <div className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-line bg-surface p-1 shadow-pop" onMouseDown={(e) => e.preventDefault()}>
          {hasList ? (
            <ul id={listId} role="listbox" aria-label={placeholder}>
              {visible.map((r, i) => (
                <li
                  key={r.id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  className={`flex min-h-(--tap-row) cursor-pointer flex-wrap items-center rounded-sm px-3 py-1.5 text-sm ${i === active ? "bg-surface-hover" : ""}`}
                  onClick={() => choose(r)}
                  onMouseEnter={() => setActive(i)}
                >
                  {renderOption ? (
                    renderOption(r)
                  ) : (
                    <>
                      <span className="font-medium">{r.label}</span>
                      {r.sublabel ? <span className="ml-2 text-ink-muted">{r.sublabel}</span> : null}
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-start gap-1 px-3 py-2 text-sm">
              <p className="text-ink-muted">{status === "error" ? t("common.searchUnavailable") : t("common.noResults")}</p>
              {createHref && status === "done" ? (
                <TextLink href={`${createHref}${createHref.includes("?") ? "&" : "?"}${createParam}=${encodeURIComponent(query.trim().slice(0, 40))}`}>{createLabel ?? t("common.createNew")}</TextLink>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
