"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/i18n/client";
import { ScrollArea } from "./scroll-area";

/**
 * Tabelle oder Codeblock in einer Markdown-Seite: Läuft er über, ist der Bereich per Tastatur erreichbar und benannt (`ScrollArea`) – sonst käme niemand an die verdeckten Spalten oder Zeilen
 * (axe `scrollable-region-focusable`). Passt alles hinein, gibt es keinen zusätzlichen Tab-Stopp.
 */
export function MarkdownScroll({ kind, children }: { kind: "table" | "code"; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <ScrollArea label={t(`ui.markdown.${kind}`)} hint={false}>
      {children}
    </ScrollArea>
  );
}
