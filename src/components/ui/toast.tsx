"use client";

import { X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useI18n } from "@/i18n/client";
import { Button } from "./buttons";
import { Alert } from "./layout";

/**
 * Toast: kurze Rückmeldung unten im Bild (nach dem Speichern, Löschen, Umschalten …). Er löst den minimalen Meldungsbereich von P1a-5 ab:
 * Die Quelle ist dieselbe – ein Meldungsschlüssel aus dem Flash-Cookie einer Server Action (`FlashMessage` zeigt ihn an) oder eine Meldung, die ein
 * Formular nach dem Speichern selbst meldet (`Form`).
 *
 * - **Erfolg** verschwindet nach `TOAST_SUCCESS_MS` (mindestens 5 s; steht still, solange man mit Maus oder Tastatur darauf ist), ein **Fehler bleibt**, bis man ihn schließt.
 * - Mit `action` (ein Knopf, z. B. „Neu laden“ bei einer neuen Version) bleibt auch ein Hinweis stehen, bis man ihn schließt oder den Knopf drückt.
 * - Er liegt unten über der Safe-Area des Geräts und über der Aktionsleiste eines Formulars (`FormActions`, siehe `.toast-viewport` in globals.css).
 * - **Die beiden Live-Regionen sind immer im DOM** (leer, solange es keine Meldung gibt): Screenreader sagen nur Änderungen an einer Region an, die schon da war.
 *   Erfolg kommt in die höfliche (`polite`), ein Fehler in die sofortige (`assertive`) Region.
 */
export const TOAST_SUCCESS_MS = 6000;
const MAX_TOASTS = 4;

export type ToastTone = "success" | "error" | "info";
export type ToastAction = { label: string; onClick: () => void };
export type ToastInput = { id?: string; tone: ToastTone; text: string; action?: ToastAction };
type ToastItem = ToastInput & { id: string };

type ToastApi = { show: (toast: ToastInput) => void; dismiss: (id: string) => void };
const ToastContext = createContext<ToastApi | null>(null);

let counter = 0;

/** Toast anzeigen: `const toast = useToast(); toast.show({ tone: "success", text })`. Dieselbe `id` zeigt eine Meldung nur einmal. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast muss innerhalb von <ToastProvider> verwendet werden.");
  return api;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: string) => setItems((list) => list.filter((item) => item.id !== id)), []);
  const show = useCallback((toast: ToastInput) => {
    const id = toast.id ?? `t${++counter}`;
    setItems((list) => (list.some((item) => item.id === id) ? list : [...list, { ...toast, id }].slice(-MAX_TOASTS)));
  }, []);
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  const { t } = useI18n();
  const polite = items.filter((item) => item.tone !== "error");
  const assertive = items.filter((item) => item.tone === "error");
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-viewport no-print">
        <div aria-live="polite" aria-atomic="false" data-flash-region="polite" className="flex flex-col gap-2">
          {polite.map((item) => (
            <ToastCard key={item.id} item={item} dismiss={dismiss} closeLabel={t("common.close")} />
          ))}
        </div>
        <div aria-live="assertive" aria-atomic="false" data-flash-region="assertive" className="flex flex-col gap-2">
          {assertive.map((item) => (
            <ToastCard key={item.id} item={item} dismiss={dismiss} closeLabel={t("common.close")} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ item, dismiss, closeLabel }: { item: ToastItem; dismiss: (id: string) => void; closeLabel: string }) {
  const [paused, setPaused] = useState(false);
  const sticky = item.tone === "error" || item.action !== undefined;
  useEffect(() => {
    if (sticky || paused) return;
    const timer = setTimeout(() => dismiss(item.id), TOAST_SUCCESS_MS);
    return () => clearTimeout(timer);
  }, [sticky, paused, dismiss, item.id]);
  return (
    <div
      data-flash={item.tone}
      className="pointer-events-auto rounded-md shadow-pop"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Alert tone={item.tone === "error" ? "danger" : item.tone === "success" ? "success" : "info"} live={false}>
        <div className="flex items-start justify-between gap-3">
          <span className="pt-0.5">{item.text}</span>
          <Button variant="ghost" size="icon-sm" aria-label={closeLabel} onClick={() => dismiss(item.id)}>
            <X className="size-4" aria-hidden />
          </Button>
        </div>
        {item.action ? (
          <div className="mt-2">
            <Button size="sm" onClick={item.action.onClick}>
              {item.action.label}
            </Button>
          </div>
        ) : null}
      </Alert>
    </div>
  );
}
