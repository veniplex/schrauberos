"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { useI18n } from "@/i18n/client";
import { type FormAction, isNetworkError } from "./form-frame";
import type { FormState } from "./form-context";
import { useToast } from "./toast";

const shown = new WeakSet<object>();

/**
 * Server Action für **einzelne Knöpfe** (Schnellstatus, Umbuchen, Schalter in Listen), die kein Formular mit Feldern sind: `<form action={dispatch}>` mit versteckten Feldern und
 * einem oder mehreren Absende-Knöpfen. Der Hook bringt mit, was `Form` für ganze Formulare tut – Wartezustand (`pending`), **Netzwerkfehler als Meldung** statt als
 * Fehlerseite, **Erfolg und Fehler als Toast** (ein Fehler bleibt stehen, bis man ihn schließt) – und gibt die Antwort der Aktion zurück (z. B. Zusatzfelder aus `state` der
 * Aktion). Die Aktion muss mit `(prev, formData)` aufgerufen werden können (jede mit `defineAction` erzeugte).
 */
export function useInlineAction<S extends FormState = FormState>(action: FormAction<S>): readonly [state: S, dispatch: (data: FormData) => void, pending: boolean] {
  const { t } = useI18n();
  const toast = useToast();
  const [initial] = useState<FormState>(() => ({}));

  const run = useCallback(
    async (previous: S, data: FormData): Promise<S> => {
      try {
        return await action(previous, data);
      } catch (error) {
        if (isNetworkError(error)) return { error: t("common.network"), network: true } as S;
        throw error;
      }
    },
    [action, t],
  );
  const [current, dispatch, pending] = useActionState<FormState, FormData>(run as unknown as FormAction, initial);
  const state = current as S;

  useEffect(() => {
    if (current === initial || shown.has(current)) return;
    shown.add(current);
    if (state.ok) {
      if (state.message) toast.show({ tone: "success", text: state.message });
      return;
    }
    const text = state.error ?? Object.values(state.fieldErrors ?? {})[0];
    if (text) toast.show({ tone: "error", text });
  }, [current, initial, state, toast]);

  return [state, dispatch, pending] as const;
}
