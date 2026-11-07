"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Check, Loader2 } from "lucide-react";
import { useI18n } from "@/i18n/client";

/** Neuer Idempotenzschlüssel: derselbe Knopfdruck trägt bei jeder Wiederholung denselben Schlüssel. */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  c?.getRandomValues?.(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Stempel-Knopf (Zeiterfassung: Kommen/Gehen/Auftrag starten/beenden): groß (mindestens 64 px hoch, volle Breite am Handy), **gegen Doppeltippen gesichert** und **wiederholbar ohne doppelte Buchung**.
 *
 *  - Solange die Buchung läuft, ist der Knopf gesperrt; direkt nach Erfolg ignoriert er Antippen noch `cooldownMs` (Standard 1,5 s) – ein zweiter Finger oder ein Wackler bucht nicht noch einmal.
 *  - `onStamp(idempotencyKey)` bekommt einen Schlüssel für diese Buchung. Scheitert sie (kein Netz), bleibt der Schlüssel **erhalten**: Ein erneutes Antippen sendet denselben Schlüssel, der Server
 *    erkennt die Wiederholung (`Idempotency-Key`, README „Programmierschnittstelle“) und bucht nicht doppelt – auch wenn die erste Anfrage doch angekommen war. Nach Erfolg gibt es einen neuen Schlüssel.
 *  - Der Zustand (Meldung, Fehler) steht in einer Live-Region.
 */
export function StampButton({
  children,
  onStamp,
  cooldownMs = 1500,
  tone = "primary",
  disabled,
  className,
}: {
  children: ReactNode;
  onStamp: (idempotencyKey: string) => Promise<void>;
  cooldownMs?: number;
  tone?: "primary" | "neutral";
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<"idle" | "working" | "done" | "failed">("idle");
  const busy = useRef(false);
  const key = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function press() {
    if (busy.current || disabled) return; // synchron gesperrt: zwei Taps im selben Augenblick lösen nur einen Aufruf aus
    busy.current = true;
    key.current ??= newIdempotencyKey();
    setPhase("working");
    try {
      await onStamp(key.current);
      key.current = null;
      setPhase("done");
      timer.current = setTimeout(() => {
        busy.current = false;
        setPhase("idle");
      }, cooldownMs);
    } catch {
      busy.current = false;
      setPhase("failed");
    }
  }

  const locked = phase === "working" || phase === "done" || disabled;
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => void press()}
        aria-disabled={locked || undefined}
        aria-busy={phase === "working" || undefined}
        className={clsx(
          "btn min-h-16 w-full justify-center gap-3 px-6 text-lg font-semibold sm:w-auto sm:min-w-64",
          tone === "primary" ? "btn-primary" : "btn-secondary",
          locked && "opacity-70",
          className,
        )}
      >
        {phase === "working" ? <Loader2 className="size-5 animate-spin" aria-hidden /> : phase === "done" ? <Check className="size-5" aria-hidden /> : null}
        {children}
      </button>
      <p role="status" className={clsx("text-sm", phase === "failed" ? "text-danger-ink" : "text-ink-muted", phase === "idle" && "sr-only")}>
        {phase === "working" ? t("ui.stamp.working") : phase === "done" ? t("ui.stamp.done") : phase === "failed" ? t("ui.stamp.failed") : ""}
      </p>
    </div>
  );
}
