"use client";

import clsx from "clsx";
import { Camera, Loader2, Search } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ComponentProps, HTMLAttributes, ReactNode, Ref, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useI18n } from "@/i18n/client";
import { ImageError, browserImageEngine, prepareImage, setInputFiles, type ImageEngine } from "@/lib/image-resize";
import { Button } from "./buttons";
import { FieldContext, formErrorId, useField, useFormContext, type FieldContextValue } from "./form-context";

/** Rückgabe-Zustand aller Formular-Server-Actions (für useActionState). */
export type ActionState = {
  ok?: boolean;
  /** Allgemeine Fehlermeldung (bereits übersetzt) */
  error?: string;
  /** Feldfehler: name -> übersetzte Meldung */
  fieldErrors?: Record<string, string>;
  /** Erfolgsmeldung (bereits übersetzt) */
  message?: string;
  /** Zusatzangaben eines Fehlers für einen Hinweis im Formular (siehe `OperationFailure.data`) */
  data?: Record<string, string>;
  /** Die Anfrage hat den Server nicht erreicht (nur im Browser gesetzt) */
  network?: boolean;
};

/** Beschriftung eines Feldes oder einer Feldgruppe (`as="legend"` in einem fieldset). */
export function FieldLabel({ as: Tag = "p", className, children, ...props }: { as?: "p" | "legend" | "span"; className?: string; children: ReactNode } & HTMLAttributes<HTMLElement>) {
  return (
    <Tag {...props} className={clsx("field-label", className)}>
      {children}
    </Tag>
  );
}

export function FieldHint({ className, id, children }: { className?: string; id?: string; children: ReactNode }) {
  return (
    <p id={id} className={clsx("field-hint", className)}>
      {children}
    </p>
  );
}

/**
 * Fehlertext eines Feldes. Außerhalb eines `Form` ist er eine Live-Region (wird angesagt); innerhalb sagt die Fehlerzusammenfassung
 * (`FormErrorSummary`) alle Fehler gesammelt an – eine zweite Ansage je Feld wäre doppelt. `live`: für Fehler, die im Browser entstehen und nicht über den Zustand des Formulars
 * laufen (Bild-Upload im Editor, zu große Datei): Die Zusammenfassung kennt sie nicht, also sagt der Fehler sich selbst an.
 */
export function FieldError({ as: Tag = "p", className, id, live, children }: { as?: "p" | "span"; className?: string; id?: string; live?: boolean; children: ReactNode }) {
  const inForm = useFormContext() !== null;
  return (
    <Tag id={id} role={inForm && !live ? undefined : "alert"} className={clsx("field-error", className)}>
      {children}
    </Tag>
  );
}

/**
 * Feld mit Beschriftung. Erzeugt die Id selbst (`useId`) und gibt sie über den Kontext an das Eingabeelement darin weiter
 * (`Input`, `Select`, `Textarea`, `SearchCombobox` …); das setzt `aria-describedby` (Fehler und Hinweis), `aria-invalid` und `aria-required`.
 *
 * - `name`: Feldname im Formular – der Fehler kommt dann von selbst aus dem umgebenden `Form` (statt `error`).
 * - `htmlFor`: eine feste Id (sonst automatisch). Wer eine eigene `id` am Eingabeelement setzt, trägt sie hier ein.
 * - `group`: Gruppe von Eingaben (Kontrollkästchen, Farbwahl, mehrere Felder): `fieldset` mit `legend`, Fehler/Hinweis hängen an der Gruppe.
 * - Fehler **und** Hinweis bleiben nebeneinander sichtbar (der Fehler zuerst).
 * - `labelClassName`: Darstellung der Beschriftung (z. B. `md:sr-only`, wenn eine Kopfzeile sie ersetzt – der Name für Hilfstechnik bleibt).
 */
export function Field({
  label,
  htmlFor,
  name,
  error,
  hint,
  required,
  group,
  className,
  labelClassName,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  name?: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  group?: boolean;
  className?: string;
  labelClassName?: string;
  children: ReactNode;
}) {
  const auto = useId();
  const form = useFormContext();
  const id = htmlFor ?? auto;
  const message = error ?? (name ? form?.state.fieldErrors?.[name] : undefined);
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [message ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  const value = useMemo<FieldContextValue>(
    () => ({ id, labelId: `${id}-label`, describedBy, invalid: Boolean(message), required: Boolean(required) }),
    [id, describedBy, message, required],
  );
  const mark = required ? (
    <span aria-hidden className="required-mark ml-0.5 text-danger-ink">
      *
    </span>
  ) : null;
  const notes = (
    <>
      {message ? <FieldError id={errorId}>{message}</FieldError> : null}
      {hint ? <FieldHint id={hintId}>{hint}</FieldHint> : null}
    </>
  );
  if (group) {
    return (
      <FieldContext.Provider value={value}>
        <fieldset className={clsx("m-0 min-w-0 border-0 p-0", className)} aria-describedby={describedBy} data-field={name}>
          <legend id={value.labelId} className="field-label p-0">
            {label}
            {mark}
          </legend>
          {children}
          {notes}
        </fieldset>
      </FieldContext.Provider>
    );
  }
  return (
    <FieldContext.Provider value={value}>
      <div className={className} data-field={name}>
        <label id={value.labelId} className={clsx("field-label", labelClassName)} htmlFor={id}>
          {label}
          {mark}
        </label>
        {children}
        {notes}
      </div>
    </FieldContext.Provider>
  );
}

type WithInvalid = { invalid?: boolean };

/**
 * Id, Beschreibung und Fehlerzustand eines Eingabeelements: ausdrückliche Eigenschaften gewinnen, sonst das umgebende `Field`. Ohne `Field` (Zeilenformulare, Tabellenzellen)
 * gilt der Fehler zum `name` aus dem umgebenden `Form` (`FormFieldError` zeigt den Text mit der passenden Id).
 */
function useFieldAttributes(props: {
  id?: string;
  name?: string;
  invalid?: boolean;
  "aria-describedby"?: string;
  "aria-required"?: boolean | "true" | "false";
}): { id: string | undefined; "aria-describedby": string | undefined; "aria-invalid": true | undefined; "aria-required": boolean | "true" | "false" | undefined } {
  const field = useField();
  const form = useFormContext();
  const bare = !field && props.name ? form?.state.fieldErrors?.[props.name] : undefined;
  return {
    id: props.id ?? field?.id,
    "aria-describedby": props["aria-describedby"] ?? field?.describedBy ?? (bare && props.name ? formErrorId(props.name) : undefined),
    "aria-invalid": (props.invalid ?? field?.invalid ?? Boolean(bare)) ? true : undefined,
    "aria-required": props["aria-required"] ?? (field?.required ? true : undefined),
  };
}

/** Touch-Gerät oder schmaler Bildschirm (gleiche Bedingung wie die Tokens `--tap`/`--input-font` in tokens.css) */
const isTouchLayout = () => window.matchMedia("(pointer: coarse), (max-width: 1023px)").matches;

/** Setzt eine Referenz (Funktion oder Objekt) – für zusammengeführte Referenzen. */
function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

/**
 * `autoFocus` nur am Desktop und nur **einmal beim Einhängen**: Auf Touch-Geräten springt sonst die Tastatur auf und verdeckt das Formular; ein
 * Fokus bei jedem Rendern (Referenzfunktion im Rumpf) risse den Fokus nach jedem Neuzeichnen zurück ins Feld. Eine übergebene `ref` bleibt erhalten.
 */
function useDesktopAutoFocus<T extends HTMLElement>(autoFocus: boolean | undefined, ref: Ref<T> | undefined) {
  const element = useRef<T | null>(null);
  const wanted = useRef(autoFocus);
  useEffect(() => {
    if (wanted.current && !isTouchLayout()) element.current?.focus();
  }, []);
  return useCallback(
    (el: T | null) => {
      element.current = el;
      assignRef(ref, el);
    },
    [ref],
  );
}

/** Bildschirmtastatur eines Zahlenfeldes: `decimal` bei Nachkommastellen (`step` mit Punkt oder `any`), sonst `numeric`. */
export function numberInputMode(step: string | number | undefined): "decimal" | "numeric" {
  const text = String(step ?? "");
  return text === "any" || /\./.test(text) ? "decimal" : "numeric";
}

/**
 * Eingabefeld. Zahlenfelder (`type="number"`) bekommen von selbst die passende Bildschirmtastatur (`inputMode` numeric bzw. decimal bei
 * Nachkommastellen), und `autoFocus` wirkt nur am Desktop und nur einmal – auf Touch-Geräten springt sonst die Tastatur auf und verdeckt das Formular.
 * Id, `aria-describedby`, `aria-invalid` und `aria-required` kommen vom umgebenden `Field`.
 */
export function Input({ invalid, className, autoFocus, inputMode, ref, ...props }: InputHTMLAttributes<HTMLInputElement> & WithInvalid & { ref?: Ref<HTMLInputElement> }) {
  const mode = inputMode ?? (props.type === "number" ? numberInputMode(props.step) : undefined);
  const setRef = useDesktopAutoFocus(autoFocus, ref);
  const attributes = useFieldAttributes({ id: props.id, name: props.name, invalid, "aria-describedby": props["aria-describedby"], "aria-required": props["aria-required"] });
  return <input {...props} {...attributes} inputMode={mode} ref={setRef} className={clsx("input", className)} />;
}

/** Suchfeld mit Lupe (für Listen und Filter). */
export function SearchInput({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  return (
    <div className={clsx("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
      <input enterKeyHint="search" inputMode="search" {...props} type="search" className="input pl-9" />
    </div>
  );
}

/** Kontrollkästchen mit Beschriftung (und optionalem Hinweis). */
export function Checkbox({
  label,
  hint,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> & { label: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={clsx("flex min-h-(--tap-row) min-w-(--tap-row) items-start gap-2.5 py-[max(0px,calc((var(--tap-row)_-_1.25rem)/2))] text-sm", className)}>
      {/* 20 px große Fläche; Ziel ist die ganze Zeile (das Label), mindestens --tap-row hoch */}
      <input {...props} type="checkbox" className="size-5 shrink-0 accent-[var(--accent)]" />
      <span>
        {label}
        {hint ? <span className="mt-0.5 block text-xs text-ink-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

/** Farbauswahl. */
export function ColorInput({ className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return <input {...props} type="color" className={clsx("h-(--tap) w-14 cursor-pointer rounded-md border border-control bg-surface p-1", className)} />;
}

const MEGABYTE = 1024 * 1024;

type FileProblem = "tooLarge" | "heic" | "failed";

/**
 * Dateiauswahl. Prüft die Größe **vor dem Absenden** (`maxBytes`, Standard 10 MB): Eine zu große Datei wird abgelehnt, das Feld geleert und
 * „Datei zu groß (max. 10 MB)“ angezeigt – statt einer generischen Fehlerseite des Servers. `onReject` übernimmt die Meldung selbst (zweites Argument: der Grund).
 *
 * `variant="photo"` ist der Foto-Baustein: Rasterbilder werden vor dem Absenden auf 1600 px verkleinert und als JPEG (Qualität 0,8) kodiert (`src/lib/image-resize.ts`);
 * PDF, XML, GIF, Bilder mit Transparenz u. a. bleiben, wie sie sind. **`maxBytes` gilt für das verkleinerte Ergebnis**: Ein 6-MB-Handyfoto passt dann auch in ein 2-MB-Feld.
 * Die verkleinerte Datei wird ins Dateifeld zurückgeschrieben (`DataTransfer`) – ein Formular mit Server Action sendet, was im Feld steht, sonst ginge das Original hoch.
 * Während der Verarbeitung steht „Foto wird verkleinert …“, und das Formular lässt sich nicht absenden (sonst ginge ebenfalls das Original hoch).
 * Bei Touch gibt es zusätzlich „Foto aufnehmen“ (Kamera, `capture`); `camera={false}` lässt ihn weg. Ein HEIC-Foto, das der Browser nicht dekodieren kann (Chrome unter
 * Android), wird mit einer verständlichen Erklärung abgelehnt.
 */
export function FileInput({
  className,
  maxBytes = 10 * MEGABYTE,
  onReject,
  onChange,
  ref,
  variant = "file",
  camera = true,
  imageEngine = browserImageEngine,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  ref?: Ref<HTMLInputElement>;
  maxBytes?: number;
  onReject?: (file: File, reason?: FileProblem) => void;
  variant?: "file" | "photo";
  /** Nur `variant="photo"`: Knopf „Foto aufnehmen“ bei Touch (Standard an) */
  camera?: boolean;
  /** Nur für Tests: Dekodieren/Kodieren austauschen */
  imageEngine?: ImageEngine;
}) {
  const { t } = useI18n();
  const field = useField();
  const errorId = useId();
  const statusId = useId();
  const [problem, setProblem] = useState<FileProblem | null>(null);
  const [pending, setPending] = useState(false);
  const inner = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  // Dateien, die der Baustein selbst bereitgestellt hat (verkleinert oder bewusst unverändert): sie werden nicht noch einmal verarbeitet
  const prepared = useRef(new WeakSet<File>());
  const run = useRef(0);
  const photo = variant === "photo";

  const setRef = useCallback(
    (element: HTMLInputElement | null) => {
      inner.current = element;
      if (typeof ref === "function") ref(element);
      else if (ref) ref.current = element;
    },
    [ref],
  );

  // Solange ein Foto verkleinert wird, gibt es nichts abzusenden (das Feld enthielte noch das Original)
  useEffect(() => {
    const form = inner.current?.form;
    if (!pending || !form) return;
    const block = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    form.addEventListener("submit", block, true);
    return () => form.removeEventListener("submit", block, true);
  }, [pending]);

  const reject = (file: File, reason: FileProblem) => {
    // `onReject`: Der Aufrufer meldet die Ablehnung selbst (z. B. ein verstecktes Feld hinter einem Werkzeugknopf); sonst steht der Hinweis unter dem Feld
    setProblem(onReject ? null : reason);
    if (inner.current) inner.current.value = "";
    onReject?.(file, reason);
  };

  /** Eine aussortierte Datei bei Mehrfachauswahl: ein Hinweis, der den Rest nicht aufhält (das Feld behält die übrigen Dateien). */
  const note = (file: File, reason: FileProblem) => {
    setProblem(onReject ? null : reason);
    onReject?.(file, reason);
  };

  /**
   * Verarbeitet die gewählten Dateien; gibt die zu sendenden zurück oder null, wenn abgelehnt (das Feld ist dann geleert). Bei **Mehrfachauswahl** (`multiple`) scheitert nicht die ganze
   * Auswahl an einer Datei: HEIC, das der Browser nicht dekodiert, oder eine zu große Datei wird aussortiert (Hinweis) und die übrigen gehen weiter – nur wenn nichts übrig bleibt, wird abgelehnt.
   */
  async function settle(input: HTMLInputElement, picked: File[]): Promise<File[] | null> {
    let files = picked;
    let dropped: { file: File; reason: FileProblem } | null = null;
    if (photo && picked.some((file) => !prepared.current.has(file))) {
      const mine = ++run.current;
      setPending(true);
      try {
        const out: File[] = [];
        for (const file of picked) {
          if (prepared.current.has(file)) {
            out.push(file);
            continue;
          }
          try {
            out.push((await prepareImage(file, imageEngine, { maxBytes })).file);
          } catch (error) {
            if (!props.multiple) throw error;
            dropped ??= { file, reason: error instanceof ImageError && error.code === "heic" ? "heic" : "failed" };
          }
        }
        if (mine !== run.current) return null; // inzwischen wurde etwas anderes gewählt
        if (out.length === 0 && dropped) {
          reject(dropped.file, dropped.reason);
          return null;
        }
        // zurück ins Feld; geht das nicht (sehr alter Browser), bleiben die Originale stehen – außer es fielen Dateien weg: dann lieber nichts
        if (out.length !== picked.length || out.some((file, i) => file !== picked[i])) {
          if (setInputFiles(input, out)) files = out;
          else if (out.length === picked.length) files = picked;
          else {
            reject(dropped?.file ?? picked[0], dropped?.reason ?? "failed");
            return null;
          }
        }
        for (const file of files) prepared.current.add(file);
      } catch (error) {
        if (mine !== run.current) return null;
        reject(picked[0], error instanceof ImageError && error.code === "heic" ? "heic" : "failed");
        return null;
      } finally {
        if (mine === run.current) setPending(false);
      }
    }
    return withinLimit(input, files, dropped);
  }

  /** Größenprüfung (für das, was gesendet würde); bei Überschreitung abgelehnt und das Feld geleert – bei Mehrfachauswahl fallen nur die zu großen Dateien weg. Gibt die zu sendenden Dateien zurück oder null. */
  function withinLimit(input: HTMLInputElement, files: File[], dropped: { file: File; reason: FileProblem } | null = null): File[] | null {
    const tooBig = files.filter((file) => file.size > maxBytes);
    if (tooBig.length === 0) {
      if (dropped) note(dropped.file, dropped.reason);
      else setProblem(null);
      return files;
    }
    if (props.multiple && tooBig.length < files.length) {
      const fits = files.filter((file) => file.size <= maxBytes);
      if (setInputFiles(input, fits)) {
        note(tooBig[0], "tooLarge");
        return fits;
      }
    }
    reject(tooBig[0], "tooLarge");
    return null;
  }

  async function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const picked = Array.from(input.files ?? []);
    if (picked.length === 0) {
      setProblem(null);
      onChange?.(event);
      return;
    }
    // ohne Foto-Verarbeitung gleich, ohne Umweg über eine asynchrone Wartezeit
    if (!photo) {
      if (withinLimit(input, picked)) onChange?.(event);
      return;
    }
    if (await settle(input, picked)) onChange?.(event);
  }

  // Kamera: das Foto wird verkleinert, ins eigentliche Feld gelegt und dort wie jede andere Auswahl gemeldet
  async function handleCamera(event: ChangeEvent<HTMLInputElement>) {
    const shot = Array.from(event.target.files ?? []);
    event.target.value = "";
    const main = inner.current;
    if (!main || shot.length === 0) return;
    const files = await settle(main, shot);
    if (!files || !setInputFiles(main, files)) return;
    main.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const describedBy = [props["aria-describedby"] ?? field?.describedBy, problem ? errorId : null, pending ? statusId : null].filter(Boolean).join(" ") || undefined;
  return (
    <>
      <div className={photo && camera ? "flex flex-wrap items-center gap-2" : undefined}>
        <input
          {...props}
          id={props.id ?? field?.id}
          aria-describedby={describedBy}
          aria-invalid={problem || field?.invalid ? true : undefined}
          aria-busy={pending || undefined}
          type="file"
          ref={setRef}
          onChange={(event) => void handleChange(event)}
          className={clsx(
            "block min-h-(--tap) w-full text-sm text-ink-muted file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-control file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-surface-hover",
            photo && camera && "min-w-0 flex-1 basis-56",
            className,
          )}
        />
        {photo && camera ? (
          <>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden tabIndex={-1} onChange={(event) => void handleCamera(event)} />
            {/* nur bei Touch: Am Rechner gibt es keine Kamera-Auswahl, dort genügt das Dateifenster */}
            <Button className="hidden pointer-coarse:inline-flex" disabled={pending || props.disabled} onClick={() => cameraRef.current?.click()}>
              <Camera className="size-4" aria-hidden /> {t("common.photoCamera")}
            </Button>
          </>
        ) : null}
      </div>
      {photo ? (
        // immer im DOM, damit der Wechsel angesagt wird (eine erst beim Auftauchen eingefügte Live-Region sagen Screenreader oft nicht an)
        <p id={statusId} role="status" className={pending ? "mt-1 flex items-center gap-2 text-xs text-ink-muted" : "sr-only"}>
          {pending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> {t("common.photoWorking")}
            </>
          ) : null}
        </p>
      ) : null}
      {problem ? (
        <p id={errorId} role="alert" className="field-error">
          {problem === "tooLarge" ? t("common.fileTooLarge", { max: Math.round(maxBytes / MEGABYTE) }) : problem === "heic" ? t("common.photoHeic") : t("common.photoFailed")}
        </p>
      ) : null}
    </>
  );
}

export function Select({ invalid, className, children, autoFocus, ref, ...props }: SelectHTMLAttributes<HTMLSelectElement> & WithInvalid & { ref?: Ref<HTMLSelectElement> }) {
  const setRef = useDesktopAutoFocus(autoFocus, ref);
  const attributes = useFieldAttributes({ id: props.id, name: props.name, invalid, "aria-describedby": props["aria-describedby"], "aria-required": props["aria-required"] });
  return (
    <select {...props} {...attributes} ref={setRef} className={clsx("input", className)}>
      {children}
    </select>
  );
}

export function Textarea({ invalid, masked, className, autoFocus, ref, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & WithInvalid & { ref?: Ref<HTMLTextAreaElement>; /** Inhalt wie ein Passwort verdeckt (mehrzeilige Geheimnisse, z. B. ein privater Schlüssel) */ masked?: boolean }) {
  const setRef = useDesktopAutoFocus(autoFocus, ref);
  const attributes = useFieldAttributes({ id: props.id, name: props.name, invalid, "aria-describedby": props["aria-describedby"], "aria-required": props["aria-required"] });
  return <textarea {...props} {...attributes} ref={setRef} className={clsx("input", masked && "input-masked", className)} />;
}

/** Farbauswahl aus Vorschlägen plus freier Wahl. `name` ist das Formularfeld, `onChange` meldet jede Änderung. Gehört in ein `Field group` (Beschriftung und Beschreibung der Gruppe). */
export function ColorPicker({
  name,
  value,
  presets,
  onChange,
  customLabel,
}: {
  name: string;
  value: string;
  /** Vorschlagsfarben: Hex-Wert oder Wert mit Namen (der Name ist der zugängliche Name des Knopfes – ohne ihn heißt er wie der Hex-Wert) */
  presets: ReadonlyArray<string | { value: string; label: string }>;
  onChange: (color: string) => void;
  /** Zugänglicher Name der freien Farbwahl */
  customLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets.map((preset) => {
        const c = typeof preset === "string" ? preset : preset.value;
        return (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            aria-label={typeof preset === "string" ? c : preset.label}
            aria-pressed={value.toLowerCase() === c}
            className="size-(--tap-sm) cursor-pointer rounded-full border-2 border-surface outline outline-1 outline-control aria-pressed:outline-2 aria-pressed:outline-offset-2 aria-pressed:outline-ink"
            style={{ background: c }}
          />
        );
      })}
      <ColorInput value={value} onChange={(e) => onChange(e.target.value)} aria-label={customLabel} className="size-(--tap-sm) w-(--tap-sm) p-0.5" />
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
