"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button, SubmitButton } from "@/components/ui/buttons";
import { ChecklistItem } from "@/components/ui/checklist-item";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { Field, Form, Input, Select, Textarea } from "@/components/ui/form";
import type { ActionState } from "@/components/ui/form";
import { Badge, Card } from "@/components/ui/layout";
import { Signature } from "@/components/ui/signature";
import { useI18n } from "@/i18n/client";
import { completeChecklist, discardChecklist, reopenChecklist, setChecklistItem } from "./actions";
import type { SignatureMode } from "./constants";

export type RunnerItem = {
  id: string;
  label: string;
  type: string;
  unit: string | null;
  minValue: number | null;
  maxValue: number | null;
  targetValue: number | null;
  options: string[];
  required: boolean;
  hint: string | null;
  done: boolean;
  numberValue: number | null;
  textValue: string | null;
  /** „Name, Zeit“ des Abhakens (bereits formatiert) */
  doneLabel: string | null;
  version: string;
};

const isNumeric = (type: string) => type === "measure" || type === "torque";

/** Zahl für das Eingabefeld: Dezimalkomma der Oberfläche. */
const formatNumber = (value: number | null, locale: string) => (value === null ? "" : new Intl.NumberFormat(locale === "en" ? "en" : "de-DE", { maximumFractionDigits: 3, useGrouping: false }).format(value));

type Patch = { done?: boolean; number?: string; text?: string };

/**
 * Ein Punkt der Checkliste: **speichert für sich** (Haken, Messwert beim Verlassen des Feldes, Auswahl, Text) – kein „Speichern“ am Ende. Die Zeile ist mindestens 44 px hoch (`ChecklistItem`); scheitert
 * das Speichern, bleibt der Stand sichtbar als „Nicht gespeichert“ mit „Erneut versuchen“. Jeder Punkt trägt seine eigene Version: Hat jemand anderes ihn inzwischen geändert, meldet der Server einen Konflikt
 * (die Zeile zeigt ihn und bietet „Neu laden“ an: die Seite wird neu gelesen, und die Zeile übernimmt den Stand des Servers, weil ihr `key` die Version des Punkts enthält). **Speichern ist je Punkt serialisiert:** Eine Eingabe, die beim Verlassen des Feldes
 * gespeichert wird, und ein gleich darauf folgender Haken laufen nacheinander, die zweite Anfrage trägt die Version der ersten (kein Selbstkonflikt). Ein Messwert außerhalb von Mindest-/Höchstwert wird gespeichert und als Text markiert (kein Sperren).
 */
function ItemRow({ item, editable, onDone }: { item: RunnerItem; editable: boolean; onDone: (id: string, done: boolean, serverVersion: string) => void }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [done, setDone] = useState(item.done);
  const [number, setNumber] = useState(formatNumber(item.numberValue, locale));
  const [text, setText] = useState(item.textValue ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const version = useRef(item.version);
  const saved = useRef({ number: formatNumber(item.numberValue, locale), text: item.textValue ?? "" });
  // Kette der laufenden Speichervorgänge dieses Punkts: der nächste beginnt erst, wenn der vorige die neue Version geliefert hat
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  function save(patch: Patch): Promise<void> {
    const run = queue.current.then(() => send(patch));
    queue.current = run.catch(() => undefined);
    return run;
  }

  async function send(patch: Patch): Promise<void> {
    const data = new FormData();
    data.set("id", item.id);
    data.set("version", version.current);
    if (patch.done !== undefined) data.set("done", patch.done ? "1" : "0");
    if (patch.number !== undefined && patch.number.trim() !== "") data.set("numberValue", patch.number.trim());
    if (patch.text !== undefined && patch.text.trim() !== "") data.set("textValue", patch.text);
    const state = (await setChecklistItem({}, data)) as ActionState & { version?: string; done?: boolean };
    if (!state?.ok) {
      setProblem(state?.fieldErrors ? Object.values(state.fieldErrors)[0] : (state?.error ?? t("common.errors.failed")));
      throw new Error(state?.error ?? "failed");
    }
    setProblem(null);
    if (state.version) version.current = state.version;
    const nowDone = state.done ?? patch.done ?? false;
    setDone(nowDone);
    onDone(item.id, nowDone, item.version);
    saved.current = { number: patch.number ?? "", text: patch.text ?? "" };
    // Nimmt man den Haken zurück (oder leert den Wert), löscht der Server den Wert: die Eingabe zeigt dasselbe
    if (!nowDone) {
      setNumber("");
      setText("");
    }
  }

  const numeric = Number(number.replace(",", "."));
  const outside = isNumeric(item.type) && number.trim() !== "" && Number.isFinite(numeric) && ((item.minValue !== null && numeric < item.minValue) || (item.maxValue !== null && numeric > item.maxValue));
  const fmt = (value: number) => formatNumber(value, locale);
  const rangeText =
    item.minValue !== null && item.maxValue !== null ? t("checklists.detail.range", { min: fmt(item.minValue), max: fmt(item.maxValue) }) : item.minValue !== null && item.minValue !== 0 ? t("checklists.detail.rangeMin", { min: fmt(item.minValue) }) : item.maxValue !== null ? t("checklists.detail.rangeMax", { max: fmt(item.maxValue) }) : null;
  const hint = [item.hint, item.type === "photo" ? t("checklists.detail.photoHint") : null, item.targetValue !== null ? t("checklists.detail.target", { value: `${fmt(item.targetValue)}${item.unit ? ` ${item.unit}` : ""}` }) : null, rangeText, item.doneLabel && done ? item.doneLabel : null].filter(Boolean).join(" · ");

  return (
    <li>
      <ChecklistItem
        label={
          <>
            {item.label}
            {!item.required ? <span className="ml-1.5 text-xs text-ink-muted">({t("checklists.detail.optional")})</span> : null}
          </>
        }
        checked={done}
        disabled={!editable}
        hint={hint || undefined}
        onSave={(checked) => save(checked ? { done: true, number, text } : { done: false })}
      >
        {isNumeric(item.type) ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="text"
              inputMode="decimal"
              value={number}
              disabled={!editable}
              aria-label={`${item.label}: ${t("checklists.detail.value")}`}
              aria-invalid={outside || undefined}
              className="w-32"
              onChange={(event) => setNumber(event.target.value)}
              onBlur={() => {
                if (number.trim() !== saved.current.number.trim()) void save({ number }).catch(() => undefined);
              }}
            />
            {item.unit ? <span className="text-sm text-ink-muted">{item.unit}</span> : null}
            {outside ? <Badge tone="warning">{t("checklists.detail.outOfRange")}</Badge> : null}
          </div>
        ) : item.type === "choice" ? (
          <Select
            value={text}
            disabled={!editable}
            aria-label={item.label}
            className="max-w-xs"
            onChange={(event) => {
              setText(event.target.value);
              void save({ text: event.target.value }).catch(() => undefined);
            }}
          >
            <option value="">{t("checklists.detail.choose")}</option>
            {item.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        ) : item.type === "text" ? (
          <Textarea
            value={text}
            rows={2}
            maxLength={1000}
            disabled={!editable}
            aria-label={item.label}
            onChange={(event) => setText(event.target.value)}
            onBlur={() => {
              if (text.trim() !== saved.current.text.trim()) void save({ text }).catch(() => undefined);
            }}
          />
        ) : null}
        {problem ? (
          <p role="alert" className="mt-1 flex flex-wrap items-center gap-2 text-sm text-danger-ink">
            {problem}
            <Button
              size="sm"
              onClick={() => {
                setProblem(null);
                router.refresh();
              }}
            >
              {t("checklists.detail.reload")}
            </Button>
          </p>
        ) : null}
      </ChecklistItem>
    </li>
  );
}

/** Abschließen: Pflichtpunkte, ggf. Kundenname und Unterschrift (Zeichenfeld oder getippter Name mit Bestätigung); ab dann unveränderlich. */
function CompleteForm({ id, version, mode, requiredOpen }: { id: string; version: string; mode: SignatureMode; requiredOpen: number }) {
  const { t, tp } = useI18n();
  return (
    <Card title={t("checklists.complete.title")}>
      <Form action={completeChecklist} draftKey={`checklist-complete:${id}`} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="version" value={version} />
        <p className="text-sm text-ink-muted">{t("checklists.complete.intro")}</p>
        {requiredOpen > 0 ? <p className="text-sm text-warning-ink">{tp("checklists.detail.requiredOpen", requiredOpen)}</p> : null}
        {mode !== "none" ? (
          <>
            <Field label={t("checklists.complete.customerName")} htmlFor="customerName" name="customerName" hint={t("checklists.complete.customerNameHint")} required={mode === "required"} className="max-w-sm">
              <Input id="customerName" name="customerName" maxLength={80} autoComplete="off" data-no-draft />
            </Field>
            <Field label={mode === "required" ? t("checklists.complete.signature") : t("checklists.complete.signatureOptional")} name="signature" required={mode === "required"}>
              <Signature name="signature" />
            </Field>
          </>
        ) : null}
        <Field label={t("checklists.complete.note")} htmlFor="note" name="note">
          <Textarea id="note" name="note" rows={2} maxLength={1000} />
        </Field>
        <div>
          <SubmitButton variant="primary">{t("checklists.complete.submit")}</SubmitButton>
        </div>
      </Form>
    </Card>
  );
}

export function ReopenForm({ id, version }: { id: string; version: string }) {
  const { t } = useI18n();
  return (
    <Card title={t("checklists.reopen.title")}>
      <Form action={reopenChecklist} draftKey={`checklist-reopen:${id}`} className="flex flex-col gap-3">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="version" value={version} />
        <p className="text-sm text-ink-muted">{t("checklists.reopen.intro")}</p>
        <Field label={t("checklists.reopen.reason")} htmlFor="reopen-reason" name="reason" required>
          <Textarea id="reopen-reason" name="reason" rows={2} maxLength={300} />
        </Field>
        <div>
          <SubmitButton variant="secondary">{t("checklists.reopen.submit")}</SubmitButton>
        </div>
      </Form>
    </Card>
  );
}

/**
 * Die Punkte einer Checkliste und – solange sie offen ist – das Abschließen und Verwerfen. Der Server entscheidet über alles (Rechte, offen/abgeschlossen, Auftrag offen, Pflichtpunkte, Unterschrift);
 * die Oberfläche zeigt nur den Stand und blendet aus, was nicht geht.
 */
export function ChecklistRunner({
  id,
  version,
  items,
  editable,
  canFill,
  canDiscard,
  signatureMode,
}: {
  id: string;
  version: string;
  items: RunnerItem[];
  /** offen, Berechtigung zum Ausfüllen und Auftrag offen */
  editable: boolean;
  canFill: boolean;
  canDiscard: boolean;
  signatureMode: SignatureMode;
}) {
  const { t } = useI18n();
  // lokal gespeicherte Haken – gelten nur für die Version des Punkts, mit der sie gespeichert wurden: liefert „Neu laden“ einen neueren Stand, gilt der des Servers
  const [local, setLocal] = useState<Record<string, { version: string; done: boolean }>>({});
  const isDone = (item: RunnerItem) => (local[item.id]?.version === item.version ? local[item.id].done : item.done);
  const requiredOpen = items.filter((i) => i.required && !isDone(i)).length;
  const done = items.filter(isDone).length;

  return (
    <div className="flex flex-col gap-5">
      <Card title={t("checklists.detail.items")} padded={false}>
        <p className="px-5 pt-4 text-sm text-ink-muted" role="status">
          {t("checklists.detail.progress", { done, total: items.length })}
        </p>
        <ul className="flex flex-col divide-y divide-line px-5 py-2">
          {items.map((item) => (
            <ItemRow key={`${item.id}:${item.version}`} item={item} editable={editable} onDone={(itemId, value, serverVersion) => setLocal((current) => ({ ...current, [itemId]: { version: serverVersion, done: value } }))} />
          ))}
        </ul>
      </Card>
      {editable && canFill ? <CompleteForm id={id} version={version} mode={signatureMode} requiredOpen={requiredOpen} /> : null}
      {editable && canDiscard ? (
        <form action={discardChecklist}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="version" value={version} />
          <ConfirmSubmitButton message={t("checklists.discard.confirm")} variant="ghost" size="md" confirmLabel={t("checklists.discard.action")}>
            {t("checklists.discard.action")}
          </ConfirmSubmitButton>
        </form>
      ) : null}
    </div>
  );
}
