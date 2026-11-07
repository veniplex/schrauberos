"use client";

import clsx from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/i18n/client";

/**
 * Waagerecht scrollbarer Bereich (Tabellen). **Nur wenn der Inhalt tatsächlich überläuft**, ist er per Tastatur erreichbar (`tabIndex=0`, `role="region"`, benannt über `label` –
 * sonst kommt niemand an die verdeckten Spalten); passt alles hinein, gäbe es einen überflüssigen Tab-Stopp und eine leere Region. Er zeigt, **dass** es weitergeht: ein Schatten an der
 * Kante mit verdecktem Inhalt und (`hint`) ein Hinweistext, solange rechts noch etwas fehlt. Der Name der Region ist ein anderer als der der Tabelle darin (`caption`),
 * damit Hilfstechnik nicht zweimal dasselbe ansagt.
 */
export function ScrollArea({ label, className, hint = true, children }: { label: string; className?: string; hint?: boolean; children: ReactNode }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const [scrolls, setScrolls] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
      setScrolls(el.scrollWidth > el.clientWidth + 1);
    };
    // ältere Umgebungen ohne ResizeObserver: nur beim Scrollen messen
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    el.addEventListener("scroll", measure, { passive: true });
    const frame = requestAnimationFrame(measure); // erste Messung auch ohne ResizeObserver
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, []);

  return (
    <div className="relative">
      <div ref={ref} {...(scrolls ? { tabIndex: 0, role: "region", "aria-label": t("common.scrollableLabel", { label }) } : {})} className={clsx("overflow-x-auto overscroll-x-contain", className)}>
        {children}
      </div>
      <span aria-hidden className={clsx("pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-[var(--line-strong)] to-transparent opacity-0 transition-opacity", edges.left && "opacity-40")} />
      <span aria-hidden className={clsx("pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-[var(--line-strong)] to-transparent opacity-0 transition-opacity", edges.right && "opacity-40")} />
      {hint && edges.right ? (
        <p aria-hidden className="border-t border-line px-4 py-1.5 text-xs text-ink-muted">
          {t("common.scrollHint")}
        </p>
      ) : null}
    </div>
  );
}
