"use client";

import clsx from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/i18n/client";

/**
 * Waagerecht scrollbarer Bereich (Tabellen). Ist per Tastatur erreichbar (`tabIndex=0`, benannt über `label` – sonst kommt niemand an die verdeckten Spalten),
 * und zeigt, **dass** es weitergeht: ein Schatten an der Kante mit verdecktem Inhalt und ein Hinweistext, solange rechts noch etwas fehlt.
 */
export function ScrollArea({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
    };
    // ältere Umgebungen ohne ResizeObserver: nur beim Scrollen messen
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer?.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, []);

  return (
    <div className="relative">
      <div ref={ref} tabIndex={0} role="region" aria-label={label} className={clsx("overflow-x-auto overscroll-x-contain", className)}>
        {children}
      </div>
      <span aria-hidden className={clsx("pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-[var(--line-strong)] to-transparent opacity-0 transition-opacity", edges.left && "opacity-40")} />
      <span aria-hidden className={clsx("pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-[var(--line-strong)] to-transparent opacity-0 transition-opacity", edges.right && "opacity-40")} />
      {edges.right ? (
        <p aria-hidden className="border-t border-line px-4 py-1.5 text-xs text-ink-muted">
          {t("common.scrollHint")}
        </p>
      ) : null}
    </div>
  );
}
