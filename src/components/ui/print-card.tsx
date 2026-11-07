import clsx from "clsx";
import type { CardModel } from "@/lib/print-card";
import { qrMatrix } from "@/lib/qr";
import { PrintKeep } from "./print-layout";
import { PrintQr } from "./print-label";
import { Table } from "./layout";

/**
 * Karte oder Zettel in der Druckansicht (F8): zeichnet **dasselbe Modell** wie das PDF (`server/pdf/card.ts`) – Überschrift, Kopfdaten (QR-Code oben rechts), Textabschnitte, Tabelle, Hinweise anderer
 * Funktionen und Schreiblinien für Notizen. Server-Baustein ohne Zustand; im Rahmen von `PrintLayout` (benannte Seite, `no-print`-Werkzeugleiste). Ohne Hover, ohne Farbe als einziges Merkmal.
 */
export function PrintCard({ model, qrLabel, className }: { model: CardModel; qrLabel: string; className?: string }) {
  const matrix = model.qr ? qrMatrix(model.qr.data) : null;
  const totalWeight = model.table ? model.table.columns.reduce((sum, column) => sum + (column.weight ?? 1), 0) || 1 : 1;
  return (
    <article className={clsx("print-card flex flex-col gap-4 text-sm", className)} aria-label={model.title}>
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {model.subtitle ? <p className="text-xs text-ink-muted">{model.subtitle}</p> : null}
          <h1 className="text-2xl font-semibold">{model.title}</h1>
          {model.facts.length > 0 ? (
            <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
              {model.facts.map(([label, value], index) => (
                <div key={index} className="contents">
                  <dt className="text-ink-muted">{label}</dt>
                  <dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
        {matrix && model.qr ? (
          <figure className="flex w-28 shrink-0 flex-col items-center gap-1 sm:w-32">
            <PrintQr matrix={matrix} label={qrLabel} className="aspect-square w-full" />
            <figcaption className="text-center text-[10px] leading-tight text-ink-muted">{model.qr.caption}</figcaption>
          </figure>
        ) : null}
      </header>

      {(model.blocks ?? []).map((block, index) => (
        <section key={index} className="print-keep">
          <h2 className="text-sm font-semibold">{block.heading}</h2>
          <p className="mt-1 whitespace-pre-line [overflow-wrap:anywhere]">{block.text}</p>
        </section>
      ))}

      {model.table ? (
        <section>
          <h2 className="mb-1 text-sm font-semibold">{model.table.heading}</h2>
          {model.table.rows.length === 0 ? (
            <p className="text-ink-muted">{model.table.empty}</p>
          ) : (
            <Table caption={model.table.heading} className="w-full table-fixed text-sm">
              {/* Spaltenbreiten wie im PDF: die Gewichte des Modells (`CardColumn.weight`, Standard 1) als Anteile */}
              <colgroup>
                {model.table.columns.map((column, i) => (
                  <col key={i} style={{ width: `${(((column.weight ?? 1) / totalWeight) * 100).toFixed(2)}%` }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {model.table.columns.map((column, i) => (
                    <th key={i} className={clsx(column.align === "right" && "text-right", column.align === "center" && "text-center")}>
                      {column.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {model.table.rows.map((row, index) => (
                  <tr key={index} className="print-keep">
                    {model.table!.columns.map((column, i) => (
                      <td key={i} className={clsx("[overflow-wrap:anywhere]", column.align === "right" && "text-right", column.align === "center" && "text-center")}>
                        {row[i] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </section>
      ) : null}

      {model.extras && model.extras.length > 0 ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
          {model.extras.map(([label, value], index) => (
            <div key={index} className="contents">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {model.notes ? (
        <PrintKeep>
          <h2 className="text-sm font-semibold">{model.notes.heading}</h2>
          <div aria-hidden className="mt-1">
            {Array.from({ length: Math.min(model.notes.lines, 8) }, (_, i) => (
              <div key={i} className="h-8 border-b border-line-strong" />
            ))}
          </div>
        </PrintKeep>
      ) : null}
    </article>
  );
}
