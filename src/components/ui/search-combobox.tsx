"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useI18n } from "@/i18n/client";

export type SearchOption = { id: string; label: string; sublabel?: string };

/**
 * Generisches Suchfeld mit Ergebnisliste. Fragt `endpoint?q=…` ab (Antwort `{ results: SearchOption[] }`)
 * und schreibt die Auswahl in ein verstecktes Feld `name`. Ohne Auswahl wird nichts gesendet.
 */
export function SearchCombobox({
  endpoint,
  name,
  initial,
  placeholder,
  invalid,
  required,
}: {
  endpoint: string;
  name: string;
  initial?: SearchOption | null;
  placeholder: string;
  invalid?: boolean;
  required?: boolean;
}) {
  const { t } = useI18n();
  const listId = useId();
  const [selected, setSelected] = useState<SearchOption | null>(initial ?? null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchOption[]>([]);
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
        const res = await fetch(`${endpoint}?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (!res.ok) return;
        const data = (await res.json()) as { results: SearchOption[] };
        setResults(data.results);
        setActive(0);
        setOpen(true);
      } catch {
        /* abgebrochen */
      }
    }, 180);
    return () => clearTimeout(handle);
  }, [query, endpoint]);

  const visible = query.trim() ? results : [];

  function choose(option: SearchOption) {
    setSelected(option);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-line-strong bg-surface-2 px-3 py-1.5">
        <input type="hidden" name={name} value={selected.id} />
        <div className="min-w-0 text-sm">
          <span className="font-medium">{selected.label}</span>
          {selected.sublabel ? <span className="ml-2 text-ink-muted">{selected.sublabel}</span> : null}
        </div>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={t("common.remove")} onClick={() => setSelected(null)}>
          <X className="size-4" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
      <input
        type="text"
        className="input pl-9"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
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
                className={`cursor-pointer rounded-sm px-3 py-1.5 text-sm ${i === active ? "bg-surface-hover" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(r);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="font-medium">{r.label}</span>
                {r.sublabel ? <span className="ml-2 text-ink-muted">{r.sublabel}</span> : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
