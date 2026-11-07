"use client";

import clsx from "clsx";
import { useCallback, useId, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Eraser, Undo2 } from "lucide-react";
import { useI18n } from "@/i18n/client";
import {
  createSignaturePad,
  serializeSignature,
  SIGNATURE_HEIGHT,
  SIGNATURE_MAX_BYTES,
  SIGNATURE_WIDTH,
  TYPED_NAME_MAX,
  type Point,
  type SignaturePad,
  type SignatureSurface,
  type SignatureValue,
  type SurfaceFactory,
} from "@/lib/signature";
import { Button } from "./buttons";
import { Checkbox, Field, FieldError, Input } from "./form-fields";
import { SegmentedControl } from "./segmented";

/**
 * Die Zeichenflächen des Browsers: ein sichtbares `<canvas>` (Tinte in `--paper-ink`, Papier hell, auch im dunklen Design) und frische Flächen für den Export (immer schwarz auf weiß,
 * damit die Unterschrift im Beleg gut lesbar ist). Tests tauschen beides gegen eine Attrappe.
 */
function toSurface(canvas: HTMLCanvasElement, ink: string, paper: string | null): SignatureSurface {
  const context = canvas.getContext("2d");
  const fill = () => {
    if (!context || paper === null) return;
    context.fillStyle = paper;
    context.fillRect(0, 0, canvas.width, canvas.height);
  };
  fill();
  return {
    width: canvas.width,
    height: canvas.height,
    clear() {
      context?.clearRect(0, 0, canvas.width, canvas.height);
      fill();
    },
    line(from, to, lineWidth) {
      if (!context) return;
      context.strokeStyle = ink;
      context.lineWidth = lineWidth;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
    },
    dot(at, lineWidth) {
      if (!context) return;
      context.fillStyle = ink;
      context.beginPath();
      context.arc(at.x, at.y, lineWidth / 2, 0, Math.PI * 2);
      context.fill();
    },
    toPng: () => canvas.toDataURL("image/png"),
  };
}

export type SignatureEngine = {
  /** Fläche für das sichtbare Feld */
  display(canvas: HTMLCanvasElement): SignatureSurface;
  /** Frische Fläche für den Export */
  offscreen: SurfaceFactory;
};

export const browserSignatureEngine: SignatureEngine = {
  display: (canvas) => toSurface(canvas, getComputedStyle(canvas).color || "#111", null),
  offscreen: (width, height) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return toSurface(canvas, "#000", "#fff");
  },
};

/**
 * Unterschrift am Touchscreen (Kundenfreigabe bei Mehrarbeit, Annahmeprotokoll, Checklisten): ein Zeichenfeld **oder** der Namensweg.
 *
 *  - **Zeichnen** mit Finger, Stift oder Maus über **Pointer Events** (nicht Touch-Ereignisse: ein Weg für alle Geräte, Stift mit Druckerkennung inklusive); `touch-action: none` verhindert, dass die Seite
 *    beim Unterschreiben scrollt oder zoomt. Der Zeiger wird erfasst (`setPointerCapture`), ein Strich endet auch außerhalb des Feldes sauber. Fenster-Koordinaten werden auf die feste
 *    Zeichenfläche (600 × 200) umgerechnet.
 *  - **Barrierefreie Alternative:** „Namen tippen“ – Name eintippen und mit einem Kontrollkästchen bestätigen; das Ergebnis ist gleichwertig (`typed:<Name>`). Das Zeichenfeld selbst ist für Tastatur und
 *    Screenreader nicht bedienbar und sagt das (Beschreibung); der Umschalter ist es.
 *  - **Ergebnis** im versteckten Feld `name`: gezeichnet als PNG-Data-URL (höchstens `maxBytes`, sonst „zu groß“ statt eines riesigen Feldes), getippt als `typed:<Name>`; der Server liest es mit
 *    `parseSignatureValue` (`lib/signature.ts`) und legt die PNG-Bytes als Datei ab. Das Feld hat `data-no-draft` – eine Unterschrift landet nie in einem Formularentwurf.
 *  - `engine` tauscht die Zeichenfläche aus (Tests).
 */
export function Signature({
  name,
  label,
  maxBytes = SIGNATURE_MAX_BYTES,
  defaultMode = "draw",
  onChange,
  engine = browserSignatureEngine,
  className,
}: {
  name: string;
  label?: string;
  maxBytes?: number;
  defaultMode?: "draw" | "type";
  onChange?: (value: SignatureValue | null) => void;
  engine?: SignatureEngine;
  className?: string;
}) {
  const { t } = useI18n();
  const id = useId();
  const [mode, setMode] = useState<"draw" | "type">(defaultMode);
  const [drawn, setDrawn] = useState<SignatureValue | null>(null);
  const [problem, setProblem] = useState<"tooLarge" | null>(null);
  const [typedName, setTypedName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [inked, setInked] = useState(false);
  const pad = useRef<SignaturePad | null>(null);
  const drawing = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Das Feld wird beim Einhängen mit seiner Zeichenfläche verbunden (Referenzfunktion statt Effekt: kein Zustand beim Rendern nötig)
  const attach = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      canvasRef.current = canvas;
      pad.current = canvas ? createSignaturePad({ surface: engine.display(canvas), factory: engine.offscreen, maxBytes }) : null;
    },
    [engine, maxBytes],
  );

  const typed: SignatureValue | null = useMemo(() => (confirmed && typedName.trim() ? { kind: "typed", name: typedName.trim() } : null), [confirmed, typedName]);
  const value = mode === "draw" ? drawn : typed;

  function emit(next: SignatureValue | null, kind: "draw" | "type") {
    if (kind === mode) onChange?.(next);
  }

  function commit() {
    const current = pad.current;
    if (!current) return;
    setInked(!current.isEmpty());
    const result = current.exportPng();
    if (result.ok) {
      const next: SignatureValue = { kind: "drawn", dataUrl: result.dataUrl };
      setDrawn(next);
      setProblem(null);
      emit(next, "draw");
    } else {
      setDrawn(null);
      setProblem(result.reason === "tooLarge" ? "tooLarge" : null);
      emit(null, "draw");
    }
  }

  function position(event: ReactPointerEvent<HTMLCanvasElement> | PointerEvent): Point {
    const canvas = canvasRef.current as HTMLCanvasElement;
    const box = canvas.getBoundingClientRect();
    return { x: ((event.clientX - box.left) / (box.width || 1)) * canvas.width, y: ((event.clientY - box.top) / (box.height || 1)) * canvas.height };
  }

  function down(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    drawing.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pad.current?.down(position(event));
  }
  function move(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (drawing.current !== event.pointerId) return;
    event.preventDefault();
    // Eingaben, die der Browser zwischen zwei Bildern gesammelt hat: sonst wird der Strich bei schnellem Schreiben eckig
    const batch = (event.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? [];
    for (const sample of batch.length ? batch : [event.nativeEvent as PointerEvent]) pad.current?.move(position(sample));
  }
  function up(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (drawing.current !== event.pointerId) return;
    drawing.current = null;
    pad.current?.up();
    commit();
  }

  function clear() {
    pad.current?.clear();
    setInked(false);
    setDrawn(null);
    setProblem(null);
    emit(null, "draw");
  }
  function undo() {
    pad.current?.undo();
    commit();
  }

  const serialized = serializeSignature(value);
  return (
    <fieldset className={clsx("m-0 flex min-w-0 flex-col gap-3 border-0 p-0", className)}>
      <legend className="field-label p-0">{label ?? t("ui.signature.group")}</legend>
      <SegmentedControl
        label={t("ui.signature.mode")}
        value={mode}
        onChange={(next) => {
          setMode(next);
          onChange?.(next === "draw" ? drawn : typed);
        }}
        options={[
          { value: "draw", label: t("ui.signature.draw") },
          { value: "type", label: t("ui.signature.type") },
        ]}
      />

      {/* beide Wege bleiben im DOM (der gezeichnete Strich geht beim Umschalten nicht verloren); der unbenutzte ist verborgen */}
      <div hidden={mode !== "draw"}>
        <canvas
          ref={attach}
          width={SIGNATURE_WIDTH}
          height={SIGNATURE_HEIGHT}
          role="img"
          aria-label={t("ui.signature.canvas")}
          data-signature-canvas=""
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onLostPointerCapture={up}
          onContextMenu={(event) => event.preventDefault()}
          style={{ touchAction: "none" }}
          className="aspect-[3/1] w-full cursor-crosshair select-none rounded-md border border-control bg-paper text-paper-ink"
        />
        <p className="mt-1 text-xs text-ink-muted">{t("ui.signature.hint")}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button onClick={undo} disabled={!inked}>
            <Undo2 className="size-4" aria-hidden /> {t("ui.signature.undo")}
          </Button>
          <Button onClick={clear} disabled={!inked}>
            <Eraser className="size-4" aria-hidden /> {t("ui.signature.clear")}
          </Button>
          <p role="status" className="text-sm text-ink-muted">
            {drawn ? t("ui.signature.signed") : inked ? "" : t("ui.signature.empty")}
          </p>
        </div>
        {problem ? <FieldError live>{t("ui.signature.tooLarge")}</FieldError> : null}
      </div>

      <div hidden={mode !== "type"} className="flex flex-col gap-2">
        <Field label={t("ui.signature.typedName")} hint={t("ui.signature.typedHint")} htmlFor={`${id}-name`}>
          <Input
            id={`${id}-name`}
            value={typedName}
            maxLength={TYPED_NAME_MAX}
            autoComplete="off"
            autoCapitalize="words"
            autoCorrect="off"
            spellCheck={false}
            data-no-draft
            onChange={(event) => {
              setTypedName(event.target.value);
              setConfirmed(false); // ein geänderter Name muss neu bestätigt werden
              if (mode === "type") onChange?.(null);
            }}
          />
        </Field>
        <Checkbox
          label={t("ui.signature.typedConfirm")}
          checked={confirmed}
          disabled={!typedName.trim()}
          data-no-draft
          onChange={(event) => {
            setConfirmed(event.target.checked);
            if (mode === "type") onChange?.(event.target.checked && typedName.trim() ? { kind: "typed", name: typedName.trim() } : null);
          }}
        />
        <p role="status" className="sr-only">
          {typed ? t("ui.signature.typedDone") : ""}
        </p>
      </div>

      <input type="hidden" name={name} value={serialized} data-no-draft />
    </fieldset>
  );
}
