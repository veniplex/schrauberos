import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Fehler-, Hinweis- und Statusseiten („Seite nicht gefunden“, „Das hat nicht geklappt“ …): Symbol, Titel, Text und Aktionen,
 * mittig. `fullscreen` füllt die ganze Anzeige (außerhalb des Anwendungsrahmens), sonst nur den Inhaltsbereich.
 */
export function StatusPage({
  icon: Icon,
  title,
  children,
  actions,
  tone = "neutral",
  fullscreen = false,
  status,
}: {
  icon: LucideIcon;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  tone?: "neutral" | "warning" | "danger";
  fullscreen?: boolean;
  /** Maschinenlesbare Art der Seite (`data-status`), z. B. "not-found" – die Browser-Tests erkennen daran 404-Seiten, auch wenn gestreamt der Statuscode schon 200 war */
  status?: string;
}) {
  return (
    <div data-status={status} className={clsx("grid place-items-center px-4", fullscreen ? "min-h-dvh" : "min-h-[50dvh] py-10")}>
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <Icon className={clsx("size-10", tone === "neutral" && "text-ink-muted", tone === "warning" && "text-warning-ink", tone === "danger" && "text-danger-ink")} aria-hidden />
        <h1 className="text-xl font-semibold">{title}</h1>
        {children ? <div className="text-sm text-ink-muted">{children}</div> : null}
        {actions ? <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
