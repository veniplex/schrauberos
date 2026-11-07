"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { useActionState, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { FormHTMLAttributes, ReactNode } from "react";
import { useI18n } from "@/i18n/client";
import { LinkButton, Button, SubmitButton } from "./buttons";
import { ConfirmDialog } from "./confirm-dialog";
import { Alert } from "./layout";
import { FieldError } from "./form-fields";
import { createRestoreJob, readDraft, removeDraft, restorePass, snapshotBase, takeSnapshot, versionOf, writeDraft, purgeForeignDrafts, type Entry, type RestoreJob } from "./form-draft";
import { DraftScopeContext, FormContext, formErrorId, useFormContext, type FormState } from "./form-context";
import { useToast } from "./toast";

export { clearFormDrafts } from "./form-draft";

/**
 * Der Formular-Rahmen. `Form`/`FormCard` führen die Server Action selbst aus (`useActionState`) und stellen Zustand, Fehler und Wartezustand den Feldbausteinen
 * bereit (`Field name="…"` zeigt seinen Fehler von selbst). Dazu kommen – für jedes Formular gleich –:
 *
 * - **Fehlerzusammenfassung** oben (`FormErrorSummary`): alle Fehler gesammelt, ein Klick springt ins Feld.
 * - **Eingabe bleibt erhalten:** React setzt Formulare nach jeder Aktion zurück; bei einem Fehler (auch „Keine Verbindung“) stellt der Rahmen die abgesendeten Werte wieder her
 *   (nie Passwort- und Dateifelder). Was während der Aktion getippt wurde, geht dabei nicht verloren.
 * - **Netzwerkfehler** als eigener Zustand („Keine Verbindung“, erneut absenden genügt) statt einer Fehlerseite.
 * - **Entwurf** (`draftKey`): lange Formulare merken ihre Eingabe in `sessionStorage` (nie Passwörter, Dateien und mit `data-no-draft` markierte Felder), stellen sie beim erneuten
 *   Öffnen wieder her und löschen sie **nach dem erfolgreichen Speichern** (ein Fehler oder Sitzungsablauf lässt den Entwurf stehen), bei „Verwerfen“ und beim Abmelden
 *   (`clearFormDrafts`). Entwürfe gehören der angemeldeten Person (`DraftScope`) und passen nur zur selben Vorbelegung (Fingerabdruck der Ausgangswerte) und Version der Zeile.
 *   Die Wiederherstellung funktioniert auch bei von React gesteuerten Feldern (siehe `form-draft.ts`); zustandsbehaftete Bausteine (Kundenauswahl) melden ihren Zustand über
 *   `data-draft-state`.
 * - **Erfolgsmeldung** als Toast.
 * - **`noValidate`:** Die Prüfung der Eingaben macht der Server mit übersetzten, spezifischen Meldungen (E-Mail, FIN, Datum, Zahlenbereich …); die englischen/uneinheitlichen
 *   Sprechblasen des Browsers würden sie verdecken. `required` und `type` bleiben als Hinweis für Tastatur und Bedienhilfen.
 */

/** Formulare, deren Entwurf beim Öffnen wiederhergestellt wurde (für den Hinweis „Entwurf wiederhergestellt“). */
const restoredKeys = new Set<string>();
const restoredListeners = new Set<() => void>();
const notifyRestored = () => restoredListeners.forEach((listener) => listener());
const subscribeRestored = (listener: () => void) => {
  restoredListeners.add(listener);
  return () => void restoredListeners.delete(listener);
};

/**
 * Hat die Anfrage den Server nicht erreicht? (Netzwerk weg, Zeitüberschreitung des Browsers) Ein `TypeError` zählt nur, wenn er wie ein Netzwerkfehler aussieht
 * (`fetch` meldet „Failed to fetch“ / „NetworkError …“ / „Load failed“); ein Programmierfehler (`Cannot read properties of …`) ist keiner und soll sichtbar scheitern.
 */
export function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return error instanceof TypeError && /failed to fetch|networkerror|network request failed|load failed|fetch failed|network connection was lost/i.test(error.message);
}

export type FormAction<S extends FormState = FormState> = (prev: S, formData: FormData) => Promise<S>;

type FormProps<S extends FormState = FormState> = Omit<FormHTMLAttributes<HTMLFormElement>, "action" | "children"> & {
  action: FormAction<S>;
  /** Inhalt – oder eine Funktion, die den Rückgabewert der Aktion bekommt (z. B. um nach dem Erfolg eine andere Ansicht zu zeigen) */
  children?: ReactNode | ((state: S) => ReactNode);
  /** Eindeutiger Schlüssel (z. B. `customer:neu`, `invoice:<id>`) – schaltet den Entwurf in `sessionStorage` ein */
  draftKey?: string;
  /**
   * Mit ungespeicherten Eingaben vor dem Verlassen warnen: beim Neuladen/Schließen des Tabs (`beforeunload`) **und** bei Klicks auf Links der Anwendung (Rückfrage
   * „Änderungen verwerfen?“). Die Zurück-Taste des Browsers lässt sich nicht abfangen.
   */
  warnOnLeave?: boolean;
};

const toastIds = new WeakSet<object>();

type RestoreHolder = { current: { job: RestoreJob; done?: () => void; generation: number } | null };

/** Ein Durchlauf der Wiederherstellung, danach (falls noch etwas zu tun ist) der nächste in einer weiteren Mikroaufgabe; eine neuere Wiederherstellung (`generation`) löst die laufende ab. */
function continueRestore(formRef: { current: HTMLFormElement | null }, holder: RestoreHolder, generation: number): void {
  const current = holder.current;
  if (!current || current.generation !== generation) return;
  if (restorePass(formRef.current, current.job)) queueMicrotask(() => continueRestore(formRef, holder, generation));
  else {
    holder.current = null;
    current.done?.();
  }
}

export function Form<S extends FormState = FormState>({ action, draftKey, warnOnLeave, className, children, onInput, onChange, ...props }: FormProps<S>) {
  const { t } = useI18n();
  const toast = useToast();
  const scope = useContext(DraftScopeContext);
  const formRef = useRef<HTMLFormElement>(null);
  const snapshot = useRef<Entry[]>([]);
  const initialEntries = useRef<Entry[]>([]);
  const base = useRef("");
  const dirty = useRef(false);
  const submitting = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const job: RestoreHolder = useRef(null);
  const generations = useRef(0);

  const saveDraft = useCallback(() => {
    if (draftKey) writeDraft(scope, draftKey, formRef.current, base.current);
  }, [draftKey, scope]);
  const dropDraft = useCallback(() => {
    if (!draftKey) return;
    removeDraft(scope, draftKey);
    restoredKeys.delete(draftKey);
    notifyRestored();
  }, [draftKey, scope]);

  // Zurückschreiben in Durchläufen, jeder in einer Mikroaufgabe (nach dem Festschreiben, vor dem Zeichnen): Dort verarbeitet React ein Ereignis vollständig – auch die Zustandsänderung
  // eines gesteuerten Feldes ist fertig, bevor das nächste Feld drankommt, und kein Rückruf liest einen veralteten Stand. Bleibt ein Wert dennoch hängen oder entstehen Felder durch
  // einen Wert (Reserverad), folgt ein weiterer Durchlauf (siehe `restorePass`).
  const restore = useCallback((entries: Entry[], done?: () => void) => {
    const generation = ++generations.current;
    job.current = { job: createRestoreJob(entries), done, generation };
    queueMicrotask(() => continueRestore(formRef, job, generation));
  }, []);

  const run = useCallback(
    async (previous: S, data: FormData): Promise<S> => {
      snapshot.current = takeSnapshot(formRef.current);
      dirty.current = false;
      submitting.current = true;
      if (timer.current) clearTimeout(timer.current);
      try {
        const result = await action(previous, data);
        submitting.current = false;
        // Der Entwurf geht erst nach dem Erfolg: ein Fehler, Sitzungsablauf oder Netzwerkausfall lässt ihn stehen
        if (result?.ok) dropDraft();
        return result;
      } catch (error) {
        submitting.current = false;
        if (isNetworkError(error)) return { error: t("common.network"), network: true } as S;
        throw error;
      }
    },
    [action, dropDraft, t],
  );
  const [current, dispatch, pending] = useActionState<FormState, FormData>(run as unknown as FormAction, {});
  const state = current as S;
  const first = useRef(state);

  // Nach einer Aktion hat React das Formular zurückgesetzt: bei einem Fehler die abgesendeten Werte zurückschreiben (nach dem Zurücksetzen, vor dem Zeichnen)
  useLayoutEffect(() => {
    if (state === first.current || state.ok) return;
    restore(snapshot.current, () => {
      dirty.current = true;
      saveDraft();
    });
  }, [state, restore, saveDraft]);

  // Erfolgsmeldung als Toast (einmal je Rückgabe)
  useEffect(() => {
    if (state.ok && state.message && !toastIds.has(state)) {
      toastIds.add(state);
      toast.show({ tone: "success", text: state.message });
    }
  }, [state, toast]);

  // Entwurf beim Öffnen wiederherstellen (nur, wenn er zur selben Person, Version der Zeile und Vorbelegung gehört)
  useLayoutEffect(() => {
    const form = formRef.current;
    initialEntries.current = takeSnapshot(form);
    if (!draftKey) return;
    purgeForeignDrafts(scope);
    base.current = snapshotBase(form);
    const draft = readDraft(scope, draftKey);
    if (draft && form && draft.version === versionOf(form) && draft.base === base.current) {
      restore(draft.entries);
      dirty.current = true;
      restoredKeys.add(draftKey);
      notifyRestored();
    }
    return () => {
      if (restoredKeys.delete(draftKey)) notifyRestored();
    };
  }, [draftKey, scope, restore]);
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
      // Das Formular verschwindet mitten im Absenden (Weiterleitung nach dem Speichern): erfolgreich gespeichert, der Entwurf ist erledigt
      if (submitting.current && draftKey) removeDraft(scope, draftKey);
    },
    [draftKey, scope],
  );

  const changed = () => {
    dirty.current = true;
    // Während des Absendens zählt die neueste Eingabe (React setzt das Formular danach zurück; bei einem Fehler wird sie statt des Standes beim Absenden zurückgeschrieben)
    if (submitting.current) {
      snapshot.current = takeSnapshot(formRef.current);
      return;
    }
    if (!draftKey) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(saveDraft, 400);
  };

  const discard = () => {
    if (!draftKey) return;
    dropDraft();
    dirty.current = false;
    formRef.current?.reset();
    restore(initialEntries.current);
  };

  const value = useMemo(() => ({ state, pending, restored }), [state, pending, restored]);
  const errorCount = Object.keys(state.fieldErrors ?? {}).length;
  return (
    <FormContext.Provider value={value}>
      <form
        noValidate
        {...props}
        ref={formRef}
        data-draft-key={draftKey}
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
        {/* Pflichtfeld-Legende vor den Feldern: wer „*“ liest, soll die Erklärung schon kennen */}
        <p className="hidden text-xs text-ink-muted group-has-[.required-mark]/form:block">{t("common.requiredNote")}</p>
        {errorCount > 0 ? <FormErrorSummary /> : null}
        {typeof children === "function" ? children(state) : children}
        {warnOnLeave ? <LeaveGuard dirtyRef={dirty} /> : null}
      </form>
    </FormContext.Provider>
  );
}

/**
 * Navigationsbremse (`warnOnLeave`): Ein Klick auf einen Link der Anwendung mit ungespeicherten Eingaben öffnet die Rückfrage „Änderungen verwerfen?“, statt sie stumm zu
 * verlieren (`beforeunload` fängt nur das Neuladen). Links mit Zusatztasten, in neuen Tabs oder zu Dateien und Sprungmarken auf derselben Seite bleiben unberührt.
 */
function LeaveGuard({ dirtyRef }: { dirtyRef: { current: boolean } }) {
  const { t } = useI18n();
  const router = useRouter();
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !dirtyRef.current) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setTarget(`${url.pathname}${url.search}${url.hash}`);
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [dirtyRef]);

  return (
    <ConfirmDialog
      open={target !== null}
      title={t("common.discardTitle")}
      description={t("common.discardText")}
      confirmLabel={t("common.discard")}
      cancelLabel={t("common.keepEditing")}
      onCancel={() => setTarget(null)}
      onConfirm={() => {
        const href = target;
        setTarget(null);
        dirtyRef.current = false;
        if (href) router.push(href);
      }}
    />
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
    <Alert tone="danger" ref={root} tabIndex={-1} data-form-errors className="w-full basis-full py-3 outline-offset-2">
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
    </Alert>
  );
}

/** Allgemeine Fehlermeldung des Formulars (und – mit `state` von außen – auch die Erfolgsmeldung, für Formulare ohne `Form`). */
export function FormMessage({ state }: { state?: FormState }) {
  const context = useFormContext();
  const s = state ?? context?.state;
  if (!s) return null;
  if (s.error) {
    return (
      <Alert tone={s.network ? "warning" : "danger"} role="alert" className="px-3 py-2">
        {s.error}
      </Alert>
    );
  }
  if (!context && s.ok && s.message) {
    return (
      <Alert tone="success" className="px-3 py-2">
        {s.message}
      </Alert>
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
 * Unsichtbarer Standard-Absender (Enter im Textfeld): sendet das Formular ohne Zusatzfeld – wie die Hauptaktion, an deren Stelle er steht. Nicht fokussierbar und vor Bedienhilfen
 * verborgen (die sichtbare Hauptaktion ist der eigentliche Knopf); während des Absendens gesperrt wie sie, damit Enter nicht doppelt absendet.
 */
function DefaultSubmit() {
  const { pending } = useFormStatus();
  return <button type="submit" tabIndex={-1} aria-hidden disabled={pending} className="sr-only" data-default-submit />;
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
        {/* Enter in einem Textfeld löst den **ersten** Absende-Knopf im Dokument aus: bei zwei Aktionen soll das die Hauptaktion sein, nicht „Speichern und weiter“ (steht aus Gründen der Reihenfolge davor) */}
        {secondaryLabel ? <DefaultSubmit /> : null}
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
