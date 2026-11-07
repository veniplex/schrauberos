"use client";

import { Download, Loader2 } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/buttons";
import { Field, Select } from "@/components/ui/form";
import { Alert } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import type { CsvFormatId } from "@/server/csv/format";
import { filenameFromDisposition } from "./download";

/**
 * Export (CSV): wählt das Format und lädt die Datei über `/api/exchange/<art>`. Die Route verlangt den eigenen Header `X-Requested-With` (ein fremder Link darf keinen Export auslösen),
 * deshalb läuft der Abruf per `fetch` und die Datei wird dem Browser als Download übergeben – Fehlermeldungen (zu viele Zeilen, ungültiger Zeitraum, fehlendes Recht) erscheinen hier,
 * nicht als rohe Antwortseite. `children`: Auswahlfelder der Art (Zeitraum, Richtung …) – ihre Namen werden als Abfrage mitgeschickt. `fixed`: feste Parameter (übernommene Filter der Liste).
 */
export function ExportPanel({ kind, defaultFormat, fixed = {}, children }: { kind: string; defaultFormat: CsvFormatId; fixed?: Record<string, string>; children?: ReactNode }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = new URLSearchParams(fixed);
    for (const [key, value] of new FormData(event.currentTarget)) if (typeof value === "string" && value !== "") query.set(key, value);
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/exchange/${kind}?${query.toString()}`, { headers: { "x-requested-with": "schrauberos" } });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        setMessage({ tone: "danger", text: body?.message ?? t("exchange.exportFailed") });
        return;
      }
      const name = filenameFromDisposition(response.headers.get("content-disposition"), `${kind}.csv`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setMessage({ tone: "success", text: t("exchange.downloaded", { name }) });
    } catch {
      setMessage({ tone: "danger", text: t("exchange.exportFailed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-4">
      {children}
      <Field label={t("exchange.format.label")} htmlFor={`export-format-${kind}`} hint={t("exchange.format.hint")}>
        <Select id={`export-format-${kind}`} name="format" defaultValue={defaultFormat}>
          <option value="excel-de">{t("exchange.format.excelDe")}</option>
          <option value="international">{t("exchange.format.international")}</option>
        </Select>
      </Field>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      <div>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
          {busy ? t("exchange.preparing") : t("exchange.download")}
        </Button>
      </div>
    </form>
  );
}
