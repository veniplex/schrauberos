"use client";

import clsx from "clsx";
import { useActionState, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { FormHTMLAttributes, ReactNode } from "react";
import { useI18n } from "@/i18n/client";
import { LinkButton, Button, SubmitButton } from "./buttons";
import { Alert } from "./layout";
import { FieldError } from "./form";
import { FormContext, formErrorId, useFormContext, type FormState } from "./form-context";
import { useToast } from "./toast";

/**
 * Der Formular-Rahmen. `Form`/`FormCard` führen die Server Action selbst aus (`useActionState`) und stellen Zustand, Fehler und Wartezustand den Feldbausteinen
 * bereit (`Field name="…"` zeigt seinen Fehler von selbst). Dazu kommen – für jedes Formular gleich –:
 *
 * - **Fehlerzusammenfassung** oben (`FormErrorSummary`): alle Fehler gesammelt, ein Klick springt ins Feld.
 * - **Eingabe bleibt erhalten:** React setzt Formulare nach jeder Aktion zurück; bei einem Fehler (auch „Keine Verbindung“) stellt der Rahmen die abgesendeten Werte wieder her
 *   (nie Passwort- und Dateifelder).
 * - **Netzwerkfehler** als eigener Zustand („Keine Verbindung“, erneut absenden genügt) statt einer Fehlerseite.
 * - **Entwurf** (`draftKey`): lange Formulare merken ihre Eingabe in `sessionStorage` (nie Passwörter, Dateien und mit `data-no-draft` markierte Felder), stellen sie beim erneuten
 *   Öffnen wieder her und löschen sie nach dem Speichern und beim Abmelden (`clearFormDrafts`).
 * - **Erfolgsmeldung** als Toast.
 * - **`noValidate`:** Die Prüfung der Eingaben macht der Server mit übersetzten, spezifischen Meldungen (E-Mail, FIN, Datum, Zahlenbereich …); die englischen/uneinheitlichen
 *   Sprechblasen des Browsers würden sie verdecken. `required` und `type` bleiben als Hinweis für Tastatur und Bedienhilfen.
 */

const DRAFT_PREFIX = "so_draft:";

type Entry = { name: string; kind: "value" | "check" | "multi"; value: string | string[]; checked?: boolean; sensitive?: boolean };

const SKIPPED_TYPES = new Set(["password", "file", "hidden", "submit", "button", "image", "reset"]);

/** Werte des Formulars (ohne Passwort-, Datei- und versteckte Felder), in Dokumentreihenfolge. */
function takeSnapshot(form: HTMLFormElement | null): Entry[] {
  if (!form) return [];
  const out: Entry[] = [];
  for (const element of Array.from(form.elements)) {
    if (element instanceof HTMLInputElement) {
      if (!element.name || element.disabled || SKIPPED_TYPES.has(element.type)) continue;
      const sensitive = element.hasAttribute("data-no-draft");
      if (element.type === "checkbox" || element.type === "radio") out.push({ name: element.name, kind: "check", value: element.value, checked: element.checked, sensitive });
      else out.push({ name: element.name, kind: "value", value: element.value, sensitive });
    } else if (element instanceof HTMLTextAreaElement) {
      if (element.name && !element.disabled) out.push({ name: element.name, kind: "value", value: element.value, sensitive: element.hasAttribute("data-no-draft") });
    } else if (element instanceof HTMLSelectElement) {
      if (!element.name || element.disabled) continue;
      const sensitive = element.hasAttribute("data-no-draft");
      if (element.multiple) out.push({ name: element.name, kind: "multi", value: Array.from(element.selectedOptions).map((o) => o.value), sensitive });
      else out.push({ name: element.name, kind: "value", value: element.value, sensitive });
    }
  }
  return out;
}

/**
 * Setzt den Wert wie eine Eingabe des Menschen: über den nativen Setter und ein `input`-Ereignis, damit auch von React gesteuerte Felder (Zustand statt `defaultValue`)
 * den Wert übernehmen – ein bloßes `element.value = …` würde beim nächsten Rendern wieder überschrieben.
 */
function setValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  if (element.value === value) return;
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(element, value);
  else element.value = value;
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

/** Schreibt die Werte zurück (gleiche Reihenfolge wie `takeSnapshot`: Feld für Feld, nicht über Namen). */
function restoreSnapshot(form: HTMLFormElement | null, entries: Entry[]): void {
  if (!form) return;
  const queue = [...entries];
  for (const element of Array.from(form.elements)) {
    const isInput = element instanceof HTMLInputElement;
    if (isInput && (!element.name || element.disabled || SKIPPED_TYPES.has(element.type))) continue;
    if (!(isInput || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) continue;
    if (!element.name || element.disabled) continue;
    const index = queue.findIndex((entry) => entry.name === element.name);
    if (index < 0) continue;
    const [entry] = queue.splice(index, 1);
    if (entry.kind === "check" && isInput) {
      // ein Klick löst auch bei gesteuerten Kontrollkästchen die Änderung aus
      if (element.checked !== Boolean(entry.checked)) element.click();
    } else if (entry.kind === "multi" && element instanceof HTMLSelectElement) {
      for (const option of Array.from(element.options)) option.selected = (entry.value as string[]).includes(option.value);
    } else if (entry.kind === "value") {
      setValue(element, entry.value as string);
    }
  }
}

const versionOf = (form: HTMLFormElement | null) => (form?.elements.namedItem("version") as HTMLInputElement | null)?.value ?? "";

function readDraft(key: string): { version: string; entries: Entry[] } | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_PREFIX + key);
    return raw ? (JSON.parse(raw) as { version: string; entries: Entry[] }) : null;
  } catch {
    return null;
  }
}
function writeDraft(key: string, form: HTMLFormElement | null) {
  if (!form) return;
  try {
    sessionStorage.setItem(DRAFT_PREFIX + key, JSON.stringify({ version: versionOf(form), entries: takeSnapshot(form).filter((e) => !e.sensitive) }));
  } catch {
    /* Speicher voll oder gesperrt: kein Entwurf */
  }
}
function removeDraft(key: string) {
  try {
    sessionStorage.removeItem(DRAFT_PREFIX + key);
  } catch {
    /* ignorieren */
  }
}

/** Alle Entwürfe löschen (beim Abmelden: auf einem geteilten Gerät soll nichts von der Eingabe zurückbleiben). */
export function clearFormDrafts(): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(DRAFT_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {
    /* ignorieren */
  }
}

/** Formulare, deren Entwurf beim Öffnen wiederhergestellt wurde (für den Hinweis „Entwurf wiederhergestellt“). */
const restoredKeys = new Set<string>();
const restoredListeners = new Set<() => void>();
const notifyRestored = () => restoredListeners.forEach((listener) => listener());
const subscribeRestored = (listener: () => void) => {
  restoredListeners.add(listener);
  return () => void restoredListeners.delete(listener);
};

/** Hat die Anfrage den Server nicht erreicht? (Netzwerk weg, Zeitüberschreitung des Browsers) */
export function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return error instanceof TypeError;
}

export type FormAction<S extends FormState = FormState> = (prev: S, formData: FormData) => Promise<S>;

type FormProps<S extends FormState = FormState> = Omit<FormHTMLAttributes<HTMLFormElement>, "action" | "children"> & {
  action: FormAction<S>;
  /** Inhalt – oder eine Funktion, die den Rückgabewert der Aktion bekommt (z. B. um nach dem Erfolg eine andere Ansicht zu zeigen) */
  children?: ReactNode | ((state: S) => ReactNode);
  /** Eindeutiger Schlüssel (z. B. `customer:neu`, `invoice:<id>`) – schaltet den Entwurf in `sessionStorage` ein */
  draftKey?: string;
  /** Vor dem Verlassen der Seite mit ungespeicherten Eingaben warnen (`beforeunload`, z. B. Doku-Editor) */
  warnOnLeave?: boolean;
};

const toastIds = new WeakSet<object>();

export function Form<S extends FormState = FormState>({ action, draftKey, warnOnLeave, className, children, onInput, onChange, ...props }: FormProps<S>) {
  const { t } = useI18n();
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const snapshot = useRef<Entry[]>([]);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(
    async (previous: S, data: FormData): Promise<S> => {
      snapshot.current = takeSnapshot(formRef.current);
      dirty.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (draftKey) {
        removeDraft(draftKey);
        restoredKeys.delete(draftKey);
        notifyRestored();
      }
      try {
        return await action(previous, data);
      } catch (error) {
        if (isNetworkError(error)) return { error: t("common.network"), network: true } as S;
        throw error;
      }
    },
    [action, draftKey, t],
  );
  const [current, dispatch, pending] = useActionState<FormState, FormData>(run as unknown as FormAction, {});
  const state = current as S;
  const first = useRef(state);

  // Nach einer Aktion hat React das Formular zurückgesetzt: bei einem Fehler die abgesendeten Werte zurückschreiben (nach dem Zurücksetzen, vor dem Zeichnen)
  useLayoutEffect(() => {
    if (state === first.current || state.ok) return;
    restoreSnapshot(formRef.current, snapshot.current);
    dirty.current = true;
    if (draftKey) writeDraft(draftKey, formRef.current);
  }, [state, draftKey]);

  // Erfolgsmeldung als Toast (einmal je Rückgabe)
  useEffect(() => {
    if (state.ok && state.message && !toastIds.has(state)) {
      toastIds.add(state);
      toast.show({ tone: "success", text: state.message });
    }
  }, [state, toast]);

  // Entwurf beim Öffnen wiederherstellen (nur, wenn er zur selben Version der Zeile gehört)
  useLayoutEffect(() => {
    if (!draftKey) return;
    const draft = readDraft(draftKey);
    const form = formRef.current;
    if (draft && form && draft.version === versionOf(form)) {
      restoreSnapshot(form, draft.entries);
      dirty.current = true;
      restoredKeys.add(draftKey);
      notifyRestored();
    }
    return () => {
      if (restoredKeys.delete(draftKey)) notifyRestored();
    };
  }, [draftKey]);
  const restored = useSyncExternalStore(
    subscribeRestored,
    () => (draftKey ? restoredKeys.has(draftKey) : false),
    () => false,
  );

  useEffect(() => {
    if (!warnOnLeave) return;
    const handler = (event: BeforeUnloadEvent) => {
      if (!dirty.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [warnOnLeave]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const changed = () => {
    dirty.current = true;
    if (!draftKey) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => writeDraft(draftKey, formRef.current), 400);
  };

  const discard = () => {
    if (!draftKey) return;
    removeDraft(draftKey);
    restoredKeys.delete(draftKey);
    notifyRestored();
    dirty.current = false;
    formRef.current?.reset();
  };

  const value = useMemo(() => ({ state, pending, restored }), [state, pending, restored]);
  const errorCount = Object.keys(state.fieldErrors ?? {}).length;
  return (
    <FormContext.Provider value={value}>
      <form
        noValidate
        {...props}
        ref={formRef}
        action={dispatch}
        className={clsx("group/form", className)}
        onInput={(event) => {
          onInput?.(event);
          changed();
        }}
        onChange={(event) => {
          onChange?.(event);
          changed();
        }}
      >
        {restored ? (
          <Alert tone="info" className="w-full basis-full">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{t("common.draftRestored")}</span>
              <Button variant="ghost" size="sm" onClick={discard}>
                {t("common.draftDiscard")}
              </Button>
            </div>
          </Alert>
        ) : null}
        {errorCount > 0 ? <FormErrorSummary /> : null}
        {typeof children === "function" ? children(state) : children}
        <p className="hidden text-xs text-ink-muted group-has-[.required-mark]/form:block">{t("common.requiredNote")}</p>
      </form>
    </FormContext.Provider>
  );
}

/** Formular in einer Karte (Anlegen/Bearbeiten-Seiten): Felder untereinander, `className` für Breite o. Ä. */
export function FormCard<S extends FormState = FormState>({ className, ...props }: FormProps<S>) {
  return <Form {...props} className={clsx("card card-pad flex flex-col gap-4", className)} />;
}

/** Sucht das Feld mit diesem Namen im Formular: der Rahmen des `Field` (`data-field`) oder ein Element mit diesem Namen. */
function fieldTarget(form: HTMLFormElement, name: string): { control: HTMLElement | null; label: string } {
  const wrapper = Array.from(form.querySelectorAll<HTMLElement>("[data-field]")).find((el) => el.dataset.field === name);
  const named = form.elements.namedItem(name);
  const control =
    wrapper?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea, button, [tabindex='0']") ??
    ((named && !(named instanceof Element) ? (named as unknown as ArrayLike<Element>)[0] : named) as HTMLElement | null);
  const label = wrapper?.querySelector("label, legend")?.textContent ?? "";
  return { control: control && !(control instanceof HTMLInputElement && control.type === "hidden") ? control : null, label: label.replace(/\*$/, "").trim() };
}

/**
 * Fehlerzusammenfassung über dem Formular: eine Live-Region (`role="alert"`), die den Fokus bekommt, wenn Fehler hinzukommen; jeder Eintrag springt in sein Feld.
 * Die Beschriftungen holt sie nach dem Zeichnen aus dem DOM (das Feld kennt sein Label).
 */
export function FormErrorSummary() {
  const { tp } = useI18n();
  const form = useFormContext();
  const root = useRef<HTMLDivElement>(null);
  const state = form?.state;
  const errors = state?.fieldErrors ?? {};
  const names = Object.keys(errors);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const formElement = element.closest("form");
    if (formElement) {
      for (const label of Array.from(element.querySelectorAll<HTMLElement>("[data-label-for]"))) {
        const text = fieldTarget(formElement, label.dataset.labelFor ?? "").label;
        label.textContent = text ? `${text}: ` : "";
      }
    }
    element.focus();
    // bei jeder neuen Antwort (auch mit gleichen Fehlern) erneut: Fokus und Ansage für den nächsten Versuch
  }, [state]);

  if (names.length === 0) return null;
  return (
    <div ref={root} role="alert" tabIndex={-1} data-form-errors className="w-full basis-full rounded-md bg-danger-bg px-3.5 py-3 text-sm text-danger-ink outline-offset-2">
      <p className="font-medium">{tp("common.errorSummary", names.length)}</p>
      <ul className="mt-1 list-disc pl-5">
        {names.map((name) => (
          <li key={name}>
            <Button
              variant="ghost"
              size="sm"
              className="h-auto min-h-(--tap-row) justify-start whitespace-normal px-1 text-left font-normal text-danger-ink underline"
              onClick={(event) => {
                const target = fieldTarget(event.currentTarget.closest("form")!, name).control;
                target?.focus();
                target?.scrollIntoView({ block: "center" });
              }}
            >
              <span>
                <span data-label-for={name} />
                {errors[name]}
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Allgemeine Fehlermeldung des Formulars (und – mit `state` von außen – auch die Erfolgsmeldung, für Formulare ohne `Form`). */
export function FormMessage({ state }: { state?: FormState }) {
  const context = useFormContext();
  const s = state ?? context?.state;
  if (!s) return null;
  if (s.error) {
    return (
      <p role="alert" className={clsx("rounded-md px-3 py-2 text-sm", s.network ? "bg-warning-bg text-warning-ink" : "bg-danger-bg text-danger-ink")}>
        {s.error}
      </p>
    );
  }
  if (!context && s.ok && s.message) {
    return (
      <p role="status" className="rounded-md bg-success-bg px-3 py-2 text-sm text-success-ink">
        {s.message}
      </p>
    );
  }
  return null;
}

/** Fehlertext eines Feldes, das kein eigenes `Field` hat (z. B. eine Zeile mit mehreren Eingaben): liest die Meldung zum Namen aus dem umgebenden `Form`. */
export function FormFieldError({ name, className }: { name: string; className?: string }) {
  const message = useFormContext()?.state.fieldErrors?.[name];
  return message ? (
    <FieldError id={formErrorId(name)} className={className}>
      {message}
    </FieldError>
  ) : null;
}

/**
 * Aktionsleiste eines Formulars: Abbrechen, optional eine zweite Aktion („Speichern und weiter“) und die Hauptaktion. Sie klebt am unteren Rand der Seite, **solange das
 * Formular länger als der Bildschirm ist** (`position: sticky` in der Dokumentfolge, nicht `fixed`), rückt bei Touch-Geräten mit geöffneter Tastatur wieder in den Fluss
 * (nie über den Eingabefeldern) und hebt den Toast über sich (`data-form-actions` am Wurzelelement, siehe `.toast-viewport`).
 * Die allgemeine Fehlermeldung des Formulars steht über den Knöpfen.
 */
export function FormActions({
  cancelHref,
  submitLabel,
  secondaryLabel,
  children,
  className,
}: {
  cancelHref?: string;
  submitLabel?: ReactNode;
  /** Zweite Absende-Aktion (sendet `_next=1`; die Aktion entscheidet, wohin es weitergeht) */
  secondaryLabel?: ReactNode;
  /** Zusätzliches links neben den Knöpfen (z. B. ein Hinweis) */
  children?: ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  useEffect(() => {
    const root = document.documentElement;
    const count = Number(root.dataset.formActions ?? "0") + 1;
    root.dataset.formActions = String(count);
    return () => {
      const left = Number(root.dataset.formActions ?? "1") - 1;
      if (left > 0) root.dataset.formActions = String(left);
      else delete root.dataset.formActions;
    };
  }, []);
  return (
    <div className={clsx("form-actions flex flex-col gap-2", className)}>
      <FormMessage />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {children ? <div className="mr-auto text-sm text-ink-muted">{children}</div> : null}
        {cancelHref ? <LinkButton href={cancelHref}>{t("common.cancel")}</LinkButton> : null}
        {secondaryLabel ? (
          <SubmitButton variant="secondary" name="_next" value="1">
            {secondaryLabel}
          </SubmitButton>
        ) : null}
        <SubmitButton>{submitLabel ?? t("common.save")}</SubmitButton>
      </div>
    </div>
  );
}
