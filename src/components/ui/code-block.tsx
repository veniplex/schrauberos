"use client";

import clsx from "clsx";
import { Check, Copy } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { Button } from "./buttons";
import { useCopy } from "./copy";
import { ScrollArea } from "./scroll-area";

/**
 * Codebeispiel (curl-Aufruf, Konfiguration, Antwort) mit „Kopieren“. Der Text wird nie als HTML gedeutet; lange Zeilen scrollen waagerecht (der Bereich ist per Tastatur erreichbar,
 * `ScrollArea`), umgebrochen wird nicht – ein Befehl in zwei Zeilen wäre nicht mehr ausführbar. `language` ist nur eine Beschriftung. Steht in einem Beispiel ein Geheimnis,
 * gehört es nicht hierher, sondern in `SecretField` – ein Beispiel zeigt Platzhalter (`<TOKEN>`).
 */
export function CodeBlock({ code, language, label, className }: { code: string; language?: string; label?: string; className?: string }) {
  const { t } = useI18n();
  const { status, copy } = useCopy();
  const name = label ?? t("ui.code.label");
  return (
    <figure className={clsx("overflow-hidden rounded-md border border-line bg-surface-2", className)}>
      <figcaption className="flex items-center justify-between gap-2 border-b border-line px-3 py-1">
        <span className="text-xs text-ink-muted">{language ?? name}</span>
        <Button size="sm" variant="ghost" onClick={() => void copy(code)} aria-label={`${t("ui.code.copy")}: ${name}`}>
          {status === "copied" ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {t("ui.code.copy")}
        </Button>
      </figcaption>
      <ScrollArea label={name} hint={false}>
        <pre className="m-0 p-3 text-[13px] leading-relaxed">
          <code className="font-mono">{code}</code>
        </pre>
      </ScrollArea>
      <p role="status" className={clsx("px-3 pb-2 text-xs", status === "failed" ? "text-danger-ink" : "text-success-ink", status === "idle" && "sr-only")}>
        {status === "copied" ? t("ui.code.copied") : status === "failed" ? t("ui.code.copyFailed") : ""}
      </p>
    </figure>
  );
}
