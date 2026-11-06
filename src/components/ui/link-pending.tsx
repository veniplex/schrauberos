"use client";

import clsx from "clsx";
import { useLinkStatus } from "next/link";
import { Loader2 } from "lucide-react";
import { useReportNavigationPending } from "./nav-progress";

/**
 * Wartezustand eines Links: gehört als Kind in jeden `<Link>` der Bausteine (der Link ist `relative`). Zeigt nach kurzer Verzögerung ein kleines
 * Symbol am Link und meldet die Navigation an den Fortschrittsbalken (`NavProgress`).
 *
 * Das Symbol liegt **immer** im DOM, absolut positioniert und ohne eigenen Platz, und wird nur ein- und ausgeblendet (Deckkraft): Das Einfügen
 * eines Elements beim Klick ließe den Link springen (Layout-Verschiebung). Die Stelle bestimmt `className` (Standard: im rechten Innenabstand).
 */
export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  useReportNavigationPending(pending);
  return (
    <span aria-hidden data-pending={pending || undefined} className={clsx("pointer-events-none flex items-center justify-center", className ?? "absolute right-0.5 top-1/2 size-3.5 -translate-y-1/2", pending ? "pending-delay" : "opacity-0")}>
      <Loader2 className={clsx("size-full", pending && "animate-spin")} />
    </span>
  );
}
