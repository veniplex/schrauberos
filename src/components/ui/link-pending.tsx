"use client";

import clsx from "clsx";
import { useLinkStatus } from "next/link";
import { Loader2 } from "lucide-react";
import { useReportNavigationPending } from "./nav-progress";

/**
 * Wartezustand eines Links: gehört als Kind in jeden `<Link>` der Bausteine. Zeigt nach kurzer Verzögerung ein kleines Symbol am Link
 * und meldet die Navigation an den Fortschrittsbalken (`NavProgress`).
 */
export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  useReportNavigationPending(pending);
  return pending ? <Loader2 className={clsx("pending-delay size-4 shrink-0 animate-spin", className)} aria-hidden /> : null;
}
