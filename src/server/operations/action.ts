import "server-only";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import type { ActionState } from "@/components/ui/form";
import { getI18n } from "@/i18n/server";
import type { MessageKey, Translator } from "@/i18n/translate";
import { formObject } from "@/lib/forms";
import { logError } from "@/lib/log-safe";
import { requirePermission, requireSession } from "@/server/auth/session";
import { DEFAULT_KEYS, type OperationFailure } from "./errors";
import { setFlash } from "./flash";
import type { Operation, Principal } from "./operation";

/**
 * Adapter „Server Action“ des Aktions-Rahmens: FormData rein, Cookie-Sitzung, Rückmeldung als Formularzustand oder Flash, danach
 * Weiterleitung. Der Kern (`defineOperation`) kennt von alledem nichts.
 *
 * Eine so definierte Aktion versteht beide Aufrufarten von React:
 *  - `useActionState(action, {})` → `(prev, formData)` → liefert einen `ActionState` (Fehler/Feldfehler/Erfolgsmeldung am Formular),
 *  - `<form action={action}>` → `(formData)` → liefert nichts; Erfolg und Fehler kommen als **Flash-Meldung** (UX-06: auch Aktionen
 *    ohne Formularzustand geben Rückmeldung).
 * `redirect()` und `notFound()` (auch aus tieferem Code) werden nie verschluckt, sondern weitergereicht.
 */

export type ActionFunction = {
  (prev: ActionState, formData: FormData): Promise<ActionState>;
  (formData: FormData): Promise<void>;
};

type Of<T, I, R> = T | ((data: R, input: I) => T);

export type ActionOptions<I, R> = {
  /** FormData → rohe Eingabe der Operation (Standard: `formObject`, leere Felder entfallen). Hier kommen Mehrfachfelder, Häkchen und Dateien dazu. */
  form?: (formData: FormData) => unknown | Promise<unknown>;
  /** Seiten, die nach Erfolg neu geladen werden (Pfad, oder `[Pfad, "layout"]`) */
  revalidate?: Of<ReadonlyArray<string | readonly [string, "layout" | "page"]>, I, R>;
  /** Nach Erfolg weiterleiten (eine Funktion darf `undefined` liefern: dann bleibt es bei der Seite) */
  redirect?: Of<string | undefined, I, R>;
  /**
   * Weiterleitung bei der zweiten Absende-Aktion („Speichern und weiter“, Formularfeld `_next=1` von `FormActions`): hat Vorrang vor `redirect`. Liefert die Funktion
   * `undefined`, gilt `redirect`. Das Feld `_next` kommt nie in die Eingabe der Operation.
   */
  redirectNext?: Of<string | undefined, I, R>;
  /** Erfolgsmeldung (Schlüssel): im Formularzustand `message`, sonst Flash. Weglassen, wenn die Zielseite selbst meldet (z. B. `?saved=`). */
  message?: Of<MessageKey, I, R>;
  /**
   * Zusätzliche Felder im Formularzustand nach Erfolg (nur bei `(prev, formData)`), z. B. der einmalig angezeigte Klartext eines neuen
   * Wiederherstellungs-Codes. Steht nur in der Antwort der Aktion, nie in URL, Log oder Audit.
   */
  state?: (data: R, input: I, i18n: Awaited<ReturnType<typeof getI18n>>) => Record<string, unknown>;
  /** Transport-spezifische Nachbereitung nach Erfolg (z. B. Cookie setzen); `run` bleibt davon frei. */
  onSuccess?: (data: R, input: I) => unknown;
  /** Wohin nach einem Fehler weitergeleitet wird (nur bei `<form action>`; Standard: auf der Seite bleiben, Fehler als Flash) */
  redirectOnError?: string | ((formData: FormData) => string);
};

/** Fehler → Formularzustand (übersetzt). */
export function stateOf(failure: OperationFailure, t: Translator["t"]): ActionState {
  const state: ActionState = {};
  if (failure.fields) state.fieldErrors = Object.fromEntries(Object.entries(failure.fields).map(([name, f]) => [name, t(f.key, f.params)]));
  if (!failure.fields || failure.key) state.error = t(failure.key ?? DEFAULT_KEYS[failure.code], failure.params);
  return state;
}

const resolve = <T, I, R>(value: Of<T, I, R> | undefined, data: R, input: I): T | undefined => (typeof value === "function" ? (value as (d: R, i: I) => T)(data, input) : value);

/** Eine Operation als Server Action anbieten (Datei mit `"use server"`; jede Aktion wird mit `export const x = defineAction(...)` exportiert). */
export function defineAction<I, R>(operation: Operation<I, R>, options: ActionOptions<I, R> = {}): ActionFunction & { operation: Operation<I, R> } {
  const action = async (first: ActionState | FormData, second?: FormData): Promise<ActionState | void> => {
    const formMode = first instanceof FormData;
    const formData = formMode ? first : second instanceof FormData ? second : new FormData();
    // „Speichern und weiter“: Der Absender ist Transportsache und gehört nicht in die Eingabe
    const wantsNext = formData.get("_next") === "1";
    formData.delete("_next");

    // Anmeldung und Recht prüft jede Aktion selbst (Navigation und Proxy sind nur Komfort). Hängt das Recht von der Eingabe ab
    // (Dokumentationsbereich), wird zuerst nur das Formular umgeformt – nichts geprüft oder gespeichert.
    const dynamic = operation.dynamicPermission;
    const rawInput = dynamic ? await (options.form ?? formObject)(formData) : undefined;
    const needed = dynamic ? operation.permissionFor(rawInput) : operation.permission;
    const principal: Principal = needed === "authenticated" ? await requireSession({ allowPasswordChange: operation.allowPasswordChange }) : await requirePermission(needed);
    const i18n = await getI18n();
    const { t } = i18n;

    let outcome;
    try {
      outcome = await operation.execute(principal, dynamic ? rawInput : await (options.form ?? formObject)(formData));
    } catch (error) {
      unstable_rethrow(error); // redirect()/notFound() aus tieferem Code nie verschlucken
      logError(`action:${operation.name}`, error);
      outcome = { ok: false as const, failure: { code: "failed" as const } };
    }

    if (!outcome.ok) {
      if (formMode) {
        await setFlash({ tone: "error", key: outcome.failure.key ?? (outcome.failure.fields ? "validation.invalid" : DEFAULT_KEYS[outcome.failure.code]), params: outcome.failure.params });
        const target = typeof options.redirectOnError === "function" ? options.redirectOnError(formData) : options.redirectOnError;
        if (target) redirect(target);
        return;
      }
      return stateOf(outcome.failure, t);
    }

    const { data, input } = outcome;
    for (const entry of resolve(options.revalidate, data, input) ?? []) {
      if (typeof entry === "string") revalidatePath(entry);
      else revalidatePath(entry[0], entry[1]);
    }
    if (options.onSuccess) await options.onSuccess(data, input);
    const message = resolve(options.message, data, input);
    const target = (wantsNext ? resolve(options.redirectNext, data, input) : undefined) ?? resolve(options.redirect, data, input);
    if (message && (formMode || target)) await setFlash({ tone: "success", key: message });
    if (target) redirect(target);
    if (formMode) return undefined;
    const extra = options.state ? options.state(data, input, i18n) : {};
    return { ok: true, ...(message ? { message: t(message) } : {}), ...extra };
  };
  return Object.assign(action as ActionFunction, { operation });
}
