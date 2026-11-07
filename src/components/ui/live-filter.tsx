"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { useI18n } from "@/i18n/client";
import { Button } from "./buttons";
import { LIVE_FILTER_DELAY_MS, liveFilterUrl } from "./live-filter-url";

/** Felder, die erst nach einer Pause im Tippen filtern (Texteingaben); alles andere (Auswahl, Häkchen, Datum) filtert sofort. */
const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && ["text", "search", "number", "email", "tel", "url"].includes(target.type));

/**
 * Live-Filter einer `FilterBar` (P2b-1): hört auf das umgebende GET-Formular und wendet es an, ohne dass jemand „Filter“ drücken muss – Texteingaben nach einer kurzen Pause im Tippen
 * (`LIVE_FILTER_DELAY_MS`, jeder neue Tastendruck setzt die Wartezeit zurück), Auswahlfelder sofort. Es gibt **keine zweite Filterlogik**: Die Adresse entspricht dem Absenden des Formulars
 * (`router.replace`, die Seite filtert wie immer auf dem Server), `useTransition` liefert den Wartezustand (sichtbar als „Liste wird gefiltert …“ und für Hilfsmittel als Statusmeldung).
 * Der Knopf „Filter“ und Enter bleiben als Rückfall. Die Seitenzahl entfällt (ein neuer Filter beginnt auf Seite 1), der Fokus bleibt im Feld.
 * Steht in der Knopfzeile der `FilterBar` und zeigt nichts Eigenes außer dem Wartezustand.
 */
export function LiveFilter() {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const anchor = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const apply = () => {
      const target = liveFilterUrl(form.getAttribute("action") || window.location.pathname, new FormData(form).entries());
      if (target === window.location.pathname + window.location.search) return;
      startTransition(() => router.replace(target, { scroll: false }));
    };
    const schedule = (event: Event) => {
      if ((event as InputEvent).isComposing) return;
      clearTimeout(timer);
      timer = setTimeout(apply, isTyping(event.target) ? LIVE_FILTER_DELAY_MS : 0);
    };
    // Enter oder „Filter“ senden das Formular selbst: eine ausstehende Wartezeit entfällt
    const cancel = () => clearTimeout(timer);
    form.addEventListener("input", schedule);
    form.addEventListener("change", schedule);
    form.addEventListener("submit", cancel);
    return () => {
      clearTimeout(timer);
      form.removeEventListener("input", schedule);
      form.removeEventListener("change", schedule);
      form.removeEventListener("submit", cancel);
    };
  }, [router]);

  return (
    <span ref={anchor} className="inline-flex items-center gap-2 text-sm text-ink-muted" role="status" aria-live="polite">
      <Loader2 className={pending ? "size-4 animate-spin" : "invisible size-4"} aria-hidden />
      <span className={pending ? undefined : "sr-only"}>{pending ? t("common.filtering") : ""}</span>
    </span>
  );
}

/**
 * „Zurücksetzen“ einer `FilterBar`: leert die Felder des umgebenden Formulars **sofort** und lädt die Liste ohne Filter (`href`). Die Felder sind unkontrolliert: Ein neuer
 * `defaultValue` der Seite ändert getippten Text nicht, und `form.reset()` käme zu früh (die neue Seite trifft erst nach dem Wechsel der Adresse ein) oder stellte bei Auswahlfeldern den
 * Stand des ersten Aufrufs wieder her. Darum: Text und Kontrollkästchen leeren, Auswahlfelder auf ihren neutralen Eintrag (Wert „“, sonst den ersten) – wie bei jeder Liste mit „Alle …“.
 */
export function ResetFilterButton({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      aria-busy={pending || undefined}
      onClick={(event) => {
        for (const field of Array.from(event.currentTarget.closest("form")?.elements ?? [])) {
          if (field instanceof HTMLInputElement && field.type !== "hidden" && field.type !== "submit" && field.type !== "button") {
            if (field.type === "checkbox" || field.type === "radio") field.checked = false;
            else field.value = "";
          } else if (field instanceof HTMLTextAreaElement) field.value = "";
          else if (field instanceof HTMLSelectElement) field.selectedIndex = Math.max(0, Array.from(field.options).findIndex((o) => o.value === ""));
        }
        startTransition(() => router.replace(href, { scroll: false }));
      }}
    >
      {children}
    </Button>
  );
}
