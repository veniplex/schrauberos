"use client";

import { useRouter } from "next/navigation";
import { Check, Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/buttons";
import { Disclosure } from "@/components/ui/disclosure";
import { Checkbox, Field, FileInput } from "@/components/ui/form";
import { Alert, Card, StatCard, StatusBadge, Table } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import type { StatusTone } from "@/lib/status-tone";
import { CSV_LIMITS } from "@/server/csv/limits";
import type { PreviewResponse, PreviewRow } from "@/server/csv/types";

type Result = { created: number; skipped: number; errors: number };
type Stage = { name: "choose" } | { name: "previewing" } | { name: "preview"; data: PreviewResponse } | { name: "applying"; data: PreviewResponse } | { name: "done"; result: Result };
type Options = { allowDuplicates: boolean; skipErrors: boolean };

/** Ton der Ergebnismarke einer Zeile der Vorschau. */
const ROW_TONE: Record<PreviewRow["status"] | "forced", StatusTone> = { create: "success", forced: "warning", duplicate: "neutral", error: "danger" };

/**
 * Import (CSV) in zwei Schritten: Datei wählen und **Vorschau** (Trockenlauf: erkannte Spalten, Zuordnung, Meldungen je Zeile, Zusammenfassung – es wird nichts gespeichert), dann
 * **bestätigen**. Die Datei bleibt im Browser; jeder Schritt schickt sie neu an `/api/exchange/<art>/import` (der Server legt sie nie ab). Die Anwendung gilt genau der Datei der Vorschau
 * (Prüfsumme). Optionen ändern die Vorschau sofort („Dubletten trotzdem anlegen“ nur bei Arten, die das anbieten).
 */
export function ImportPanel({
  kind,
  duplicateOverride,
  columns,
  rules,
}: {
  kind: string;
  duplicateOverride: boolean;
  columns: Array<{ label: string; required: boolean }>;
  rules: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [options, setOptions] = useState<Options>({ allowDuplicates: false, skipErrors: false });
  const [stage, setStage] = useState<Stage>({ name: "choose" });
  const [error, setError] = useState<string | null>(null);

  async function send(mode: "preview" | "apply", chosen: File, opts: Options, digest?: string) {
    const body = new FormData();
    body.set("file", chosen);
    body.set("mode", mode);
    if (opts.allowDuplicates) body.set("allowDuplicates", "1");
    if (opts.skipErrors) body.set("skipErrors", "1");
    if (digest) body.set("digest", digest);
    const response = await fetch(`/api/exchange/${kind}/import`, { method: "POST", body, headers: { "x-requested-with": "schrauberos" } });
    const json = (await response.json().catch(() => null)) as (Record<string, unknown> & { message?: string }) | null;
    if (!response.ok || !json) throw new Error(json?.message ?? t("exchange.importPanel.failed"));
    return json;
  }
  const failure = (e: unknown) => (e instanceof Error && e.message !== "Failed to fetch" ? e.message : t("exchange.importPanel.failed"));

  async function preview(chosen: File, opts: Options) {
    setStage({ name: "previewing" });
    setError(null);
    try {
      setStage({ name: "preview", data: (await send("preview", chosen, opts)) as unknown as PreviewResponse });
    } catch (e) {
      setStage({ name: "choose" });
      setError(failure(e));
    }
  }

  async function apply(data: PreviewResponse) {
    if (!file) return;
    setStage({ name: "applying", data });
    setError(null);
    try {
      const json = await send("apply", file, options, data.digest);
      setStage({ name: "done", result: json as unknown as Result });
      router.refresh();
    } catch (e) {
      setStage({ name: "preview", data });
      setError(failure(e));
    }
  }

  function toggle(key: keyof Options, value: boolean) {
    const next = { ...options, [key]: value };
    setOptions(next);
    // Die Vorschau gilt für die gewählten Optionen: bei einer Änderung sofort neu rechnen (ohne die Datei erneut wählen zu müssen)
    if (file && stage.name === "preview") void preview(file, next);
  }

  function reset() {
    setFile(null);
    setStage({ name: "choose" });
    setError(null);
    if (input.current) input.current.value = "";
  }

  const pending = stage.name === "previewing" || stage.name === "applying";
  const data = stage.name === "preview" || stage.name === "applying" ? stage.data : null;
  const blockedByErrors = data ? data.counts.error > 0 && !options.skipErrors : false;

  if (stage.name === "done") {
    return (
      <div className="flex max-w-3xl flex-col gap-4">
        <Alert tone="success" icon={<Check className="size-4" aria-hidden />}>
          <strong className="font-semibold">{t("exchange.importPanel.resultTitle")}</strong> {t("exchange.importPanel.result", stage.result)}
        </Alert>
        <div>
          <Button onClick={reset}>{t("exchange.importPanel.otherFile")}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <Card title={t("exchange.importPanel.step1")}>
        <div className="flex max-w-xl flex-col gap-4">
          <p className="text-sm text-ink-muted">{rules}</p>
          <Field label={t("exchange.importPanel.fileLabel")} htmlFor={`import-file-${kind}`} hint={t("exchange.importPanel.fileHint", { size: `${CSV_LIMITS.importBytes / 1024 / 1024} MB`, rows: CSV_LIMITS.importRows })}>
            <FileInput
              id={`import-file-${kind}`}
              ref={input}
              accept=".csv,.txt,text/csv,text/plain"
              maxBytes={CSV_LIMITS.importBytes}
              disabled={pending}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setStage({ name: "choose" });
                setError(null);
              }}
            />
          </Field>
          <div className="flex flex-col">
            {duplicateOverride ? (
              <Checkbox
                label={t("exchange.importPanel.allowDuplicates")}
                hint={t("exchange.importPanel.allowDuplicatesHint")}
                checked={options.allowDuplicates}
                disabled={pending}
                onChange={(e) => toggle("allowDuplicates", e.target.checked)}
              />
            ) : null}
            <Checkbox
              label={t("exchange.importPanel.skipErrors")}
              hint={t("exchange.importPanel.skipErrorsHint")}
              checked={options.skipErrors}
              disabled={pending}
              onChange={(e) => toggle("skipErrors", e.target.checked)}
            />
          </div>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant={data ? "secondary" : "primary"} disabled={!file || pending} onClick={() => file && void preview(file, options)}>
              {stage.name === "previewing" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
              {stage.name === "previewing" ? t("exchange.importPanel.previewing") : t("exchange.importPanel.preview")}
            </Button>
          </div>
        </div>
        <div className="mt-4">
          <Disclosure title={t("exchange.importPanel.expected")}>
            <p className="mb-2 text-sm text-ink-muted">{t("exchange.importPanel.expectedHint")}</p>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {columns.map((c) => (
                <li key={c.label}>
                  {c.label}
                  {c.required ? <span className="text-ink-muted"> ({t("exchange.importPanel.required")})</span> : null}
                </li>
              ))}
            </ul>
          </Disclosure>
        </div>
      </Card>

      {data ? (
        <Card title={t("exchange.importPanel.step2")}>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink-muted">{t("exchange.importPanel.detected", { encoding: data.encoding, delimiter: data.delimiter === "\t" ? "Tab" : data.delimiter })}</p>
            {data.missing.length > 0 ? <Alert tone="danger">{t("exchange.importPanel.missing", { columns: data.missing.join(", ") })}</Alert> : null}
            {data.formulaLike > 0 ? <Alert tone="info">{t("exchange.importPanel.formulaLike", { count: data.formulaLike })}</Alert> : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatCard label={t("exchange.importPanel.createCount")} value={data.counts.create} tone="success" sub={data.counts.forced > 0 ? t("exchange.importPanel.forcedCount", { count: data.counts.forced }) : undefined} />
              <StatCard label={t("exchange.importPanel.duplicateCount")} value={data.counts.duplicate} />
              <StatCard label={t("exchange.importPanel.errorCount")} value={data.counts.error} tone={data.counts.error > 0 ? "danger" : undefined} />
            </div>

            <Disclosure title={t("exchange.importPanel.columns")} defaultOpen={data.columns.some((c) => c.note !== null)}>
              <Table caption={t("exchange.importPanel.columns")}>
                <thead>
                  <tr>
                    <th>{t("exchange.importPanel.colHeader")}</th>
                    <th>{t("exchange.importPanel.colMapped")}</th>
                    <th>{t("exchange.importPanel.colNote")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.columns.map((c, i) => (
                    <tr key={`${c.header}-${i}`}>
                      <td>{c.header}</td>
                      <td>{c.label ?? <span className="text-ink-muted">{t("exchange.importPanel.notUsed")}</span>}</td>
                      <td className="text-ink-muted">{c.note}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Disclosure>

            {data.rows.length > 0 ? (
              <>
                <Table caption={t("exchange.importPanel.rows")}>
                  <thead>
                    <tr>
                      <th>{t("exchange.importPanel.colLine")}</th>
                      <th>{t("exchange.importPanel.colRecord")}</th>
                      <th>{t("exchange.importPanel.colStatus")}</th>
                      <th>{t("exchange.importPanel.colMessage")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <tr key={row.line}>
                        <td className="tabular">{row.line}</td>
                        <td className="break-words">{row.label}</td>
                        <td>
                          <StatusBadge tone={ROW_TONE[row.forced ? "forced" : row.status]}>{t(`exchange.status.${row.forced ? "forced" : row.status}`)}</StatusBadge>
                        </td>
                        <td className="text-sm">{row.messages.join(" ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <p className="text-xs text-ink-muted">
                  {t("exchange.importPanel.sampleHint")} {data.truncated ? t("exchange.importPanel.truncated") : null}
                </p>
              </>
            ) : null}

            {blockedByErrors ? <Alert tone="warning">{t("exchange.importPanel.errorsBlock", { count: data.counts.error })}</Alert> : null}
            {data.counts.create === 0 && data.missing.length === 0 ? <Alert tone="info">{t("exchange.importPanel.nothing")}</Alert> : null}
            {error ? <Alert tone="danger">{error}</Alert> : null}

            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={pending || !data.canApply || blockedByErrors} onClick={() => void apply(data)}>
                {stage.name === "applying" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
                {stage.name === "applying" ? t("exchange.importPanel.applying") : t("exchange.importPanel.apply")}
              </Button>
              <Button disabled={pending} onClick={reset}>
                {t("exchange.importPanel.otherFile")}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
