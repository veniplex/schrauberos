"use client";

import clsx from "clsx";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "@/i18n/client";

/**
 * Verlauf und Fortschritt: `Timeline` zeigt, **was geschehen ist** (Auftragsverlauf, Statuswechsel mit Zeitpunkt und Person), `Stepper` zeigt, **wo man in einer festen Folge steht**
 * (Angenommen → In Arbeit → Fertig → Abgeholt). Beide sind Listen (`<ol>`); der Zustand eines Schritts steht auch als Text da (nicht nur an Farbe und Symbol), der aktuelle Schritt trägt
 * `aria-current="step"`.
 */

export type TimelineTone = "success" | "info" | "warning" | "danger" | "neutral";
export type TimelineItem = { id: string; title: ReactNode; description?: ReactNode; /** Zeitpunkt, fertig formatiert */ time?: ReactNode; tone?: TimelineTone };

const DOT: Record<TimelineTone, string> = {
  success: "bg-success-ink",
  info: "bg-info-ink",
  warning: "bg-warning-ink",
  danger: "bg-danger-ink",
  neutral: "bg-ink-muted",
};

export function Timeline({ items, label, className }: { items: readonly TimelineItem[]; label?: string; className?: string }) {
  const { t } = useI18n();
  return (
    <ol aria-label={label ?? t("ui.timeline.label")} className={clsx("flex flex-col", className)}>
      {items.map((item, index) => (
        <li key={item.id} className="relative flex gap-3 pb-5 last:pb-0">
          {index < items.length - 1 ? <span aria-hidden className="absolute bottom-0 left-[0.4375rem] top-4 w-px bg-line-strong" /> : null}
          <span aria-hidden className={clsx("relative mt-1 size-3.5 shrink-0 rounded-full ring-4 ring-surface", DOT[item.tone ?? "neutral"])} />
          <div className="min-w-0 flex-1 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="font-medium">{item.title}</p>
              {item.time ? <p className="text-xs text-ink-muted tabular">{item.time}</p> : null}
            </div>
            {item.description ? <div className="mt-0.5 text-ink-muted">{item.description}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

const STATE_TEXT = { done: "ui.timeline.done", current: "ui.timeline.current", upcoming: "ui.timeline.upcoming", skipped: "ui.timeline.skipped" } as const;

export type StepState = "done" | "current" | "upcoming" | "skipped";
export type Step = { id: string; label: ReactNode; description?: ReactNode };

/** Zustand jedes Schritts aus dem aktuellen: davor erledigt, danach offen; `skipped` markiert übersprungene Schritte (z. B. „Freigabe“ bei einem Auftrag ohne Mehrarbeit). */
export function stepStates(steps: readonly Step[], current: string, skipped: readonly string[] = []): StepState[] {
  const at = steps.findIndex((step) => step.id === current);
  return steps.map((step, index) => (skipped.includes(step.id) ? "skipped" : at < 0 ? "upcoming" : index < at ? "done" : index === at ? "current" : "upcoming"));
}

export function Stepper({ steps, current, skipped, label, className }: { steps: readonly Step[]; current: string; skipped?: readonly string[]; label?: string; className?: string }) {
  const { t } = useI18n();
  const states = stepStates(steps, current, skipped);
  return (
    <ol aria-label={label ?? t("ui.timeline.label")} className={clsx("flex flex-col gap-3 sm:flex-row sm:gap-0", className)}>
      {steps.map((step, index) => {
        const state = states[index];
        return (
          <li key={step.id} aria-current={state === "current" ? "step" : undefined} className="relative flex items-start gap-3 sm:flex-1 sm:flex-col sm:items-center sm:text-center">
            {index > 0 ? <span aria-hidden className={clsx("absolute right-1/2 top-3.5 hidden h-px w-full sm:block", states[index - 1] === "done" || state === "done" || state === "current" ? "bg-accent" : "bg-line-strong")} /> : null}
            <span
              aria-hidden
              className={clsx(
                "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                state === "done" && "border-accent bg-accent text-accent-ink",
                state === "current" && "border-accent bg-surface text-accent-text ring-2 ring-accent",
                state === "upcoming" && "border-control bg-surface text-ink-muted",
                state === "skipped" && "border-line-strong bg-surface-2 text-ink-muted line-through",
              )}
            >
              {state === "done" ? <Check className="size-4" /> : index + 1}
            </span>
            <span className="min-w-0 text-sm sm:mt-2">
              <span className={clsx("block font-medium", state === "upcoming" && "text-ink-muted")}>{step.label}</span>
              <span className="block text-xs text-ink-muted">
                <span className="sr-only">{t(STATE_TEXT[state])}</span>
                {step.description}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
