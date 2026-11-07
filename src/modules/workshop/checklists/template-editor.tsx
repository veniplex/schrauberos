"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useMemo, useReducer } from "react";
import { Button } from "@/components/ui/buttons";
import { Checkbox, Field, Form, FormActions, Input, Select, Textarea } from "@/components/ui/form";
import { useFormContext } from "@/components/ui/form-context";
import { Alert, Card } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import { saveTemplate } from "./actions";
import { ITEM_TYPES, MAX_ITEMS, SIGNATURE_MODES, type ItemType, type SignatureMode } from "./constants";

/** Ein Punkt im Editor: Zahlen als Text (Dezimalkomma erlaubt), die Prüfung macht der Server. */
export type EditorItem = { key: string; label: string; type: ItemType; required: boolean; unit: string; minValue: string; maxValue: string; targetValue: string; options: string; hint: string };

export type EditorInitial = { id?: string; version?: string; name: string; description: string; signatureMode: SignatureMode; items: Array<Omit<EditorItem, "key">>; archived?: boolean };

type Action = { type: "add" } | { type: "remove"; key: string } | { type: "move"; key: string; by: -1 | 1 } | { type: "set"; key: string; patch: Partial<EditorItem> };

let counter = 0;
const newKey = () => `i${++counter}`;
const blank = (): EditorItem => ({ key: newKey(), label: "", type: "check", required: true, unit: "", minValue: "", maxValue: "", targetValue: "", options: "", hint: "" });

function reduce(items: EditorItem[], action: Action): EditorItem[] {
  switch (action.type) {
    case "add":
      return items.length >= MAX_ITEMS ? items : [...items, blank()];
    case "remove":
      return items.filter((item) => item.key !== action.key);
    case "move": {
      const at = items.findIndex((item) => item.key === action.key);
      const to = at + action.by;
      if (at < 0 || to < 0 || to >= items.length) return items;
      const next = [...items];
      [next[at], next[to]] = [next[to], next[at]];
      return next;
    }
    case "set":
      return items.map((item) => (item.key === action.key ? { ...item, ...action.patch } : item));
  }
}

/** Zahlenfelder gehen als Text an den Server (Dezimalkomma wie getippt): er liest und prüft sie und meldet Unlesbares als Feldfehler am Punkt – nichts wird hier still zu `null`. */
const numberText = (text: string): string | null => (text.trim() === "" ? null : text.trim());

/** Fehler des Servers zu einem Punkt (`items.<n>.<feld>`) als Liste unter dem Punkt. */
function ItemErrors({ index }: { index: number }) {
  const errors = useFormContext()?.state.fieldErrors ?? {};
  const mine = Object.entries(errors).filter(([name]) => name.startsWith(`items.${index}.`));
  if (mine.length === 0) return null;
  return (
    <ul role="alert" className="mt-2 text-sm text-danger-ink">
      {mine.map(([name, text]) => (
        <li key={name}>{text}</li>
      ))}
    </ul>
  );
}

/**
 * Editor für Vorlagen (Leitung): Name, Beschreibung, Kundenunterschrift (keine/möglich/Pflicht) und die Punkte mit Art, Pflicht, Einheit, Grenzen, Sollwert, Auswahl und Hinweis; umsortieren, hinzufügen, entfernen. Die
 * Punkte gehen als ein Feld (JSON) an den Server, der sie strikt prüft; jede Änderung erzeugt eine **neue Version** (ohne Änderung bleibt es bei der bisherigen). Ein archivierte Vorlage lässt sich nicht bearbeiten.
 */
export function TemplateEditor({ initial }: { initial: EditorInitial }) {
  const { t, td } = useI18n();
  const [items, dispatch] = useReducer(reduce, initial.items, (list) => list.map((item) => ({ ...item, key: newKey() })));
  const json = useMemo(
    () =>
      JSON.stringify(
        items.map((i) => ({
          label: i.label,
          type: i.type,
          required: i.required,
          unit: i.unit || null,
          minValue: numberText(i.minValue),
          maxValue: numberText(i.maxValue),
          targetValue: numberText(i.targetValue),
          options: i.options || null,
          hint: i.hint || null,
        })),
      ),
    [items],
  );
  const archived = Boolean(initial.archived);

  return (
    <Form action={saveTemplate} draftKey={`checklist-template:${initial.id ?? "new"}`} className="flex flex-col gap-5">
      {initial.id ? (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="version" value={initial.version ?? ""} />
        </>
      ) : null}
      <input type="hidden" name="items" value={json} data-no-draft />
      {archived ? <Alert tone="warning">{t("checklists.templates.editor.archivedNote")}</Alert> : null}

      <Card>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("checklists.templates.editor.name")} htmlFor="name" name="name" required>
            <Input id="name" name="name" maxLength={80} defaultValue={initial.name} disabled={archived} />
          </Field>
          <Field label={t("checklists.templates.editor.signatureMode")} htmlFor="signatureMode" name="signatureMode">
            <Select id="signatureMode" name="signatureMode" defaultValue={initial.signatureMode} disabled={archived}>
              {SIGNATURE_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {td(`checklists.signatureModes.${mode}`, mode)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("checklists.templates.editor.description")} htmlFor="description" name="description" className="sm:col-span-2">
            <Input id="description" name="description" maxLength={300} defaultValue={initial.description} disabled={archived} />
          </Field>
          {initial.id ? (
            <Field label={t("checklists.templates.editor.note")} htmlFor="note" name="note" hint={`${t("checklists.templates.editor.noteHint")} ${t("checklists.templates.editor.unchangedNote")}`} className="sm:col-span-2">
              <Input id="note" name="note" maxLength={300} disabled={archived} />
            </Field>
          ) : null}
        </div>
      </Card>

      <Card>
        <p className="mb-4 text-sm text-ink-muted">{t("checklists.templates.editor.itemsHint")}</p>
        <Field label={t("checklists.templates.editor.items")} name="items" group>
          <ol className="flex flex-col gap-4">
            {items.map((item, index) => {
              const numeric = item.type === "measure" || item.type === "torque";
              const id = (suffix: string) => `item-${item.key}-${suffix}`;
              return (
                <li key={item.key} className="rounded-md border border-line p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">{t("checklists.templates.editor.itemNumber", { number: index + 1 })}</h3>
                    <span className="flex gap-1">
                      <Button size="icon-sm" variant="ghost" disabled={archived || index === 0} aria-label={t("checklists.templates.editor.up")} onClick={() => dispatch({ type: "move", key: item.key, by: -1 })}>
                        <ArrowUp className="size-4" aria-hidden />
                      </Button>
                      <Button size="icon-sm" variant="ghost" disabled={archived || index === items.length - 1} aria-label={t("checklists.templates.editor.down")} onClick={() => dispatch({ type: "move", key: item.key, by: 1 })}>
                        <ArrowDown className="size-4" aria-hidden />
                      </Button>
                      <Button size="icon-sm" variant="ghost" disabled={archived} aria-label={`${t("checklists.templates.editor.remove")}: ${item.label || index + 1}`} onClick={() => dispatch({ type: "remove", key: item.key })}>
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label={t("checklists.templates.editor.label")} htmlFor={id("label")} className="sm:col-span-2">
                      <Input id={id("label")} value={item.label} maxLength={200} disabled={archived} onChange={(event) => dispatch({ type: "set", key: item.key, patch: { label: event.target.value } })} />
                    </Field>
                    <Field label={t("checklists.templates.editor.type")} htmlFor={id("type")}>
                      <Select id={id("type")} value={item.type} disabled={archived} onChange={(event) => dispatch({ type: "set", key: item.key, patch: { type: event.target.value as ItemType } })}>
                        {ITEM_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {td(`checklists.itemTypes.${type}`, type)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Checkbox label={t("checklists.templates.editor.required")} checked={item.required} disabled={archived} onChange={(event) => dispatch({ type: "set", key: item.key, patch: { required: event.target.checked } })} />
                    {numeric ? (
                      <>
                        <Field label={t("checklists.templates.editor.unit")} htmlFor={id("unit")}>
                          <Input id={id("unit")} value={item.unit} maxLength={12} disabled={archived} onChange={(event) => dispatch({ type: "set", key: item.key, patch: { unit: event.target.value } })} />
                        </Field>
                        <Field label={t("checklists.templates.editor.target")} htmlFor={id("target")}>
                          <Input id={id("target")} inputMode="decimal" value={item.targetValue} disabled={archived} onChange={(event) => dispatch({ type: "set", key: item.key, patch: { targetValue: event.target.value } })} />
                        </Field>
                        <Field label={t("checklists.templates.editor.min")} htmlFor={id("min")}>
                          <Input id={id("min")} inputMode="decimal" value={item.minValue} disabled={archived} onChange={(event) => dispatch({ type: "set", key: item.key, patch: { minValue: event.target.value } })} />
                        </Field>
                        <Field label={t("checklists.templates.editor.max")} htmlFor={id("max")}>
                          <Input id={id("max")} inputMode="decimal" value={item.maxValue} disabled={archived} onChange={(event) => dispatch({ type: "set", key: item.key, patch: { maxValue: event.target.value } })} />
                        </Field>
                      </>
                    ) : null}
                    {item.type === "choice" ? (
                      <Field label={t("checklists.templates.editor.options")} htmlFor={id("options")} className="sm:col-span-2">
                        <Textarea id={id("options")} rows={3} value={item.options} disabled={archived} onChange={(event) => dispatch({ type: "set", key: item.key, patch: { options: event.target.value } })} />
                      </Field>
                    ) : null}
                    <Field label={t("checklists.templates.editor.hint")} htmlFor={id("hint")} className="sm:col-span-2">
                      <Input id={id("hint")} value={item.hint} maxLength={300} disabled={archived} onChange={(event) => dispatch({ type: "set", key: item.key, patch: { hint: event.target.value } })} />
                    </Field>
                  </div>
                  <ItemErrors index={index} />
                </li>
              );
            })}
          </ol>
        </Field>
        <div className="mt-4">
          <Button variant="secondary" disabled={archived || items.length >= MAX_ITEMS} onClick={() => dispatch({ type: "add" })}>
            <Plus className="size-4" aria-hidden /> {t("checklists.templates.editor.add")}
          </Button>
        </div>
      </Card>

      <FormActions cancelHref="/checklists/templates" submitLabel={initial.id ? t("checklists.templates.editor.save") : t("checklists.templates.editor.saveNew")} />
    </Form>
  );
}
