import clsx from "clsx";
import type { CSSProperties } from "react";
import { labelGeometry, labelsPerPage, type LabelContent, type LabelFormat } from "@/lib/labels";
import { qrMatrix, type QrMatrix } from "@/lib/qr";

/**
 * Etiketten in der Druckansicht (F8): jedes Etikett im **Maß des Etiketts** (Millimeter), auf einer eigenen benannten Seite (`@page label-…`, `globals.css`: Seitengröße = Etikett, kein Rand), der
 * A4-Bogen als Raster 3 × 8 (`skip` lässt Felder eines angebrochenen Bogens frei). Dieselben Maße wie im PDF (`lib/labels.ts`, `server/pdf/labels.ts`); das PDF ist der verlässliche Weg zum Drucker,
 * diese Ansicht der schnelle über den Druckdialog des Browsers. Im Ausdruck ist alles schwarz auf weiß, auch im dunklen Design (der QR-Code ist immer dunkel auf hell: Scanner lesen nur so).
 *
 * Server-Baustein (kein Zustand): Der QR-Code wird hier aus dem Inhalt gezeichnet (Vektor, kein Bild, kein Dienst). `qrLabel` ist der zugängliche Name des QR-Codes.
 */

/** Die Fläche des QR-Codes: Vektor aus der Matrix, mit stiller Zone von zwei Modulen (wie im PDF). Auch die Karten (`print-card.tsx`) zeichnen ihn so; `className` ersetzt die Größe des Etiketts. */
export function PrintQr({ matrix, label, className }: { matrix: QrMatrix; label: string; className?: string }) {
  const quiet = 2;
  const total = matrix.size + quiet * 2;
  let path = "";
  matrix.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === "1") path += `M${x + quiet} ${y + quiet}h1v1h-1z`;
  });
  return (
    <svg viewBox={`0 0 ${total} ${total}`} role="img" aria-label={label} shapeRendering="crispEdges" className={clsx(className ?? "print-label-qr", "bg-white text-black")}>
      <path d={path} fill="currentColor" />
    </svg>
  );
}

/**
 * Schriftgrößen und die Zeilen, die in den Kasten passen (aus Etikettenhöhe abzüglich Rand 2 mm, Titelzeile und Zeilenhöhe 1,15 gerechnet): Was darüber hinausgeht, wird mit „…“ gekürzt (`line-clamp`) –
 * nicht still abgeschnitten wie bei `overflow: hidden` allein. (Das PDF verkleinert die Schrift stufenweise bis 5 pt, bevor es kürzt: eine Druckansicht kürzt früher. Beides ist so gewollt – die Ansicht
 * ist die schnelle Vorschau, das PDF der verlässliche Weg.)
 */
const SIZES: Record<LabelFormat, { title: string; body: string; titleLines: number; bodyLines: number }> = {
  "62x29": { title: "12pt", body: "6pt", titleLines: 1, bodyLines: 7 },
  "100x50": { title: "20pt", body: "10pt", titleLines: 1, bodyLines: 8 },
  "sheet-3x8": { title: "12pt", body: "7.5pt", titleLines: 1, bodyLines: 8 },
};

/** die Zeilenzahl als Eigenschaft; `globals.css` kürzt mit `line-clamp` und „…“ */
const clamp = (lines: number) => ({ "--label-lines": lines }) as CSSProperties;

function Cell({ format, label, qrLabel, empty }: { format: LabelFormat; label?: LabelContent; qrLabel: string; empty?: boolean }) {
  const g = labelGeometry(format);
  const size = SIZES[format];
  const matrix = label?.qr ? qrMatrix(label.qr) : null;
  return (
    <div className={clsx("print-label", empty && "print-label-empty")} style={{ width: `${g.cellWidthMm}mm`, height: `${g.cellHeightMm}mm` }} data-label-cell={empty ? "empty" : "label"}>
      {label ? (
        <>
          <div className="print-label-text">
            <p className="print-label-title" style={{ fontSize: size.title, ...clamp(size.titleLines) }}>
              {label.title}
            </p>
            <p className="print-label-body" style={{ fontSize: size.body, ...clamp(size.bodyLines) }}>
              {label.lines.filter((line) => line.trim() !== "").join("\n")}
            </p>
          </div>
          {matrix ? <PrintQr matrix={matrix} label={qrLabel} /> : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * Alle Etiketten eines Drucks. Einzelformate: jedes Etikett eine Seite (Seitenumbruch nach jedem außer dem letzten). Bogen: ein Raster je Seite, `skip` Felder am Anfang bleiben leer.
 * Am Bildschirm als Vorschau mit Rahmen, im Ausdruck ohne.
 */
export function PrintLabels({ format, labels, skip = 0, qrLabel }: { format: LabelFormat; labels: readonly LabelContent[]; skip?: number; qrLabel: string }) {
  const g = labelGeometry(format);
  if (g.kind === "single") {
    return (
      <div className={`print-labels print-labels-single print-label-page-${format}`} data-label-format={format}>
        {labels.map((label, index) => (
          <div key={index} className="print-label-page">
            <Cell format={format} label={label} qrLabel={qrLabel} />
          </div>
        ))}
      </div>
    );
  }
  const perPage = labelsPerPage(format);
  const start = Math.min(Math.max(0, Math.floor(skip)), perPage - 1);
  const slots: Array<LabelContent | null> = [...Array.from({ length: start }, () => null), ...labels];
  const pages = Math.ceil(slots.length / perPage);
  return (
    <div className="print-labels print-label-page-sheet" data-label-format={format}>
      {Array.from({ length: pages }, (_, page) => (
        <div key={page} className="print-label-page print-label-sheet" style={{ width: `${g.pageWidthMm}mm`, gridTemplateColumns: `repeat(${g.columns}, ${g.cellWidthMm}mm)`, gridAutoRows: `${g.cellHeightMm}mm` }}>
          {Array.from({ length: perPage }, (_, position) => {
            const label = slots[page * perPage + position];
            return label === undefined ? null : <Cell key={position} format={format} label={label ?? undefined} qrLabel={qrLabel} empty={label === null} />;
          })}
        </div>
      ))}
    </div>
  );
}
