"use client";

import clsx from "clsx";
import { Search, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/buttons";
import { SearchInput } from "@/components/ui/form";
import { NavLink } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";

type Hit = { id: string; title: string; subtitle?: string; href: string };
type Group = { id: string; label: string; hits: Hit[] };
type Status = "idle" | "done" | "error";

/**
 * Schnellsuche über alle Funktionen (`/api/search`: die Funktionen liefern ihre Treffer selbst, die Plattform aggregiert nur).
 * Am Desktop ein Suchfeld in der Kopfleiste; auf Handy und Tablet (unter 1024 px) ein Symbol, das ein **vollbreites Feld** öffnet (44 px hoch, `inputMode="search"`,
 * `enterKeyHint="search"`). Die Treffer stehen als Links in einem Bereich unter dem Feld: Pfeil ab springt in die Liste, Pfeil auf/ab wandert durch die Treffer,
 * Escape schließt (und gibt den Fokus zurück), Enter öffnet den ersten Treffer. Die Zahl der Treffer wird angesagt.
 */
export function QuickSearch() {
  const { t, tp } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const resultsId = useId();
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [popup, setPopup] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  // Ein Seitenwechsel (Treffer geöffnet) schließt Ergebnisse und Vollbildfeld
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setPopup(false);
    setExpanded(false);
  }

  const term = query.trim();
  useEffect(() => {
    if (term.length < 2) return;
    const controller = new AbortController();
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: controller.signal });
        if (!res.ok) throw new Error(String(res.status));
        setGroups(((await res.json()) as { groups: Group[] }).groups);
        setStatus("done");
      } catch {
        if (controller.signal.aborted) return;
        setGroups([]);
        setStatus("error");
      }
      setPopup(true);
    }, 220);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [term]);

  useEffect(() => {
    if (expanded) input.current?.focus();
  }, [expanded]);

  // Klick außerhalb schließt die Ergebnisse
  useEffect(() => {
    if (!popup) return;
    const outside = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setPopup(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [popup]);

  const showResults = popup && term.length >= 2 && status !== "idle";
  const total = groups.reduce((sum, group) => sum + group.hits.length, 0);
  const announcement = !showResults ? "" : status === "error" ? t("common.searchUnavailable") : total === 0 ? t("common.noResults") : tp("common.resultsCount", total);
  const hits = () => Array.from(root.current?.querySelectorAll<HTMLAnchorElement>("[data-hit]") ?? []);

  function collapse() {
    setPopup(false);
    setExpanded(false);
    toggle.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const list = hits();
    const index = list.indexOf(document.activeElement as HTMLAnchorElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (showResults) {
        setPopup(false);
        input.current?.focus();
      } else if (expanded) collapse();
    } else if (event.key === "ArrowDown" && showResults && list.length > 0) {
      event.preventDefault();
      list[Math.min(index + 1, list.length - 1)]?.focus();
    } else if (event.key === "ArrowUp" && index >= 0) {
      event.preventDefault();
      if (index === 0) input.current?.focus();
      else list[index - 1]?.focus();
    } else if (event.key === "Enter" && document.activeElement === input.current && showResults && list.length > 0) {
      event.preventDefault();
      router.push(list[0].getAttribute("href") ?? "/");
    }
  }

  return (
    <>
      <Button ref={toggle} variant="ghost" size="icon" className="lg:hidden" aria-label={t("nav.searchOpen")} aria-expanded={expanded} aria-controls={resultsId} onClick={() => setExpanded(true)}>
        <Search className="size-4" aria-hidden />
      </Button>
      <div
        ref={root}
        role="search"
        aria-label={t("nav.search")}
        onKeyDown={onKeyDown}
        className={clsx(
          "lg:relative lg:block lg:w-full lg:max-w-md lg:p-0 lg:shadow-none",
          expanded ? "fixed inset-x-0 top-0 z-50 flex items-center gap-2 bg-surface px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] shadow-pop" : "hidden",
        )}
      >
        <SearchInput
          ref={input}
          className="min-w-0 flex-1"
          placeholder={t("nav.searchPlaceholder")}
          aria-label={t("nav.search")}
          aria-controls={showResults ? resultsId : undefined}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => status !== "idle" && term.length >= 2 && setPopup(true)}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {expanded ? (
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label={t("nav.searchClose")} onClick={collapse}>
            <X className="size-4" aria-hidden />
          </Button>
        ) : null}
        <div role="status" aria-live="polite" className="sr-only">
          {announcement}
        </div>
        {showResults ? (
          <div
            id={resultsId}
            role="region"
            aria-label={t("nav.searchResults")}
            className="absolute inset-x-0 top-full max-h-[70dvh] overflow-auto overscroll-contain border-b border-line bg-surface p-1 shadow-pop lg:mt-1 lg:rounded-lg lg:border"
          >
            {status === "error" ? (
              <p className="px-3 py-3 text-sm text-ink-muted">{t("common.searchUnavailable")}</p>
            ) : groups.length === 0 ? (
              <p className="px-3 py-3 text-sm text-ink-muted">{t("common.noResults")}</p>
            ) : (
              groups.map((group) => (
                <section key={group.id} aria-label={group.label}>
                  <h3 className="px-3 pb-0.5 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{group.label}</h3>
                  <ul>
                    {group.hits.map((hit) => (
                      <li key={hit.id}>
                        <NavLink href={hit.href} data-hit="" onClick={() => setPopup(false)}>
                          <span className="block truncate">{hit.title}</span>
                          {hit.subtitle ? <span className="block truncate text-xs font-normal text-ink-muted">{hit.subtitle}</span> : null}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}
