"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/buttons";
import { setControlValue } from "@/components/ui/form-draft";
import { DefinitionList } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";

/** Vorschlag aus der E-Rechnung, wie die Route `/api/invoices/e-invoice` ihn liefert (alles Text, Beträge schon im Eingabeformat). */
export type EInvoiceSuggestion = {
  syntax: "ubl" | "cii";
  creditNote: boolean;
  number: string;
  issueDate: string;
  dueDate: string;
  partyName: string;
  buyer: string;
  currency: string;
  net: string;
  vat: string;
  gross: string;
  warnings: Array<"currency" | "sum" | "missing">;
};

type State = { kind: "idle" } | { kind: "reading" } | { kind: "ready"; suggestion: EInvoiceSuggestion } | { kind: "error"; code: string } | { kind: "applied"; suggestion: EInvoiceSuggestion };

const looksLikeXml = (file: File) => /\.xml$/i.test(file.name) || /xml/i.test(file.type);

/** Felder des Rechnungsformulars (Ids), in die der Vorschlag auf Wunsch geschrieben wird – die Eingabefelder nehmen den Wert wie eine Eingabe des Menschen an. */
const TARGETS = { number: "number", partyName: "partyName", issueDate: "issueDate", dueDate: "dueDate", net: "net", vat: "vat", gross: "gross" } as const;

/**
 * Liest eine ausgewählte XML-E-Rechnung über den Server und zeigt die Angaben als **Vorschlag** (Vorschau). Übernommen wird erst auf Knopfdruck; die Datei bleibt als Beleg im
 * Dateifeld und wird unverändert abgelegt. Nur für Eingangsrechnungen.
 */
export function useEInvoiceReader() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const run = useRef(0);

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const mine = ++run.current;
    if (!file || !looksLikeXml(file)) {
      setState({ kind: "idle" });
      return;
    }
    setState({ kind: "reading" });
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/invoices/e-invoice", { method: "POST", body, headers: { "x-requested-with": "schrauberos" } });
      const json = (await response.json()) as { proposal?: EInvoiceSuggestion; error?: string };
      if (mine !== run.current) return; // inzwischen wurde eine andere Datei gewählt
      setState(response.ok && json.proposal ? { kind: "ready", suggestion: json.proposal } : { kind: "error", code: json.error ?? "failed" });
    } catch {
      if (mine === run.current) setState({ kind: "error", code: "failed" });
    }
  }

  function apply(suggestion: EInvoiceSuggestion) {
    for (const [field, id] of Object.entries(TARGETS)) {
      const element = document.getElementById(id);
      const value = suggestion[field as keyof typeof TARGETS];
      if (element instanceof HTMLInputElement && value) setControlValue(element, value);
    }
    setState({ kind: "applied", suggestion });
  }

  return { state, onFileChange, apply };
}

export function EInvoicePreview({ state, onApply }: { state: ReturnType<typeof useEInvoiceReader>["state"]; onApply: (suggestion: EInvoiceSuggestion) => void }) {
  const { t, td } = useI18n();
  if (state.kind === "idle") return null;
  if (state.kind === "reading") return <p className="mt-3 text-sm text-ink-muted" role="status">{t("invoices.einvoice.reading")}</p>;
  if (state.kind === "error") {
    return (
      <p className="mt-3 text-sm text-danger-ink" role="alert">
        {td(`invoices.einvoice.errors.${state.code}`, t("invoices.einvoice.errors.failed"))}
      </p>
    );
  }
  const s = state.suggestion;
  return (
    <div className="mt-4 rounded-lg border border-line p-4" role="status">
      <p className="text-sm font-medium">{t("invoices.einvoice.heading")}</p>
      <p className="mt-0.5 text-xs text-ink-muted">{t(`invoices.einvoice.syntax.${s.syntax}`)}</p>
      {s.creditNote ? <p className="mt-2 text-sm">{t("invoices.einvoice.creditNote")}</p> : null}
      <div className="mt-3">
        <DefinitionList
          items={[
            { label: t("invoices.fields.number"), value: s.number },
            { label: t("invoices.fields.supplier"), value: s.partyName },
            { label: t("invoices.fields.issueDate"), value: s.issueDate },
            { label: t("invoices.fields.dueDate"), value: s.dueDate },
            { label: t("invoices.fields.net"), value: s.net },
            { label: t("invoices.fields.vat"), value: s.vat },
            { label: t("invoices.fields.gross"), value: s.gross },
            { label: t("invoices.einvoice.buyer"), value: s.buyer },
          ]}
        />
      </div>
      {s.warnings.length > 0 ? (
        <ul className="mt-3 list-disc pl-5 text-sm text-warning-ink">
          {s.warnings.map((w) => (
            <li key={w}>{t(`invoices.einvoice.warnings.${w}`, { currency: s.currency })}</li>
          ))}
        </ul>
      ) : null}
      {state.kind === "applied" ? (
        <p className="mt-3 text-sm text-success-ink">{t("invoices.einvoice.applied")}</p>
      ) : (
        <Button variant="primary" size="sm" className="mt-3" onClick={() => onApply(s)}>
          {t("invoices.einvoice.apply")}
        </Button>
      )}
    </div>
  );
}
