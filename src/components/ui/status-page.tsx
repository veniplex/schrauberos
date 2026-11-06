import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { StatusHeading } from "./status-heading";

/**
 * Fehler-, Hinweis- und Statusseiten („Seite nicht gefunden“, „Das hat nicht geklappt“ …): Symbol, Titel, Text und Aktionen,
 * mittig. `fullscreen` füllt die ganze Anzeige (außerhalb des Anwendungsrahmens, dann ist die Seite selbst das `<main>`), sonst nur den
 * Inhaltsbereich (im Anwendungsrahmen gibt es das `<main>` schon). Die Überschrift bekommt den Fokus und setzt den Seitentitel
 * (`StatusHeading`); Fehlerseiten (`tone="danger"`) sind eine Live-Region (`role="alert"`).
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
  const Root = fullscreen ? "main" : "div";
  return (
    <Root data-status={status} className={clsx("grid place-items-center px-4", fullscreen ? "min-h-dvh" : "min-h-[50dvh] py-10")}>
      <div role={tone === "danger" ? "alert" : undefined} className="flex max-w-md flex-col items-center gap-3 text-center">
        <Icon className={clsx("size-10", tone === "neutral" && "text-ink-muted", tone === "warning" && "text-warning-ink", tone === "danger" && "text-danger-ink")} aria-hidden />
        <StatusHeading>{title}</StatusHeading>
        {children ? <div className="text-sm text-ink-muted">{children}</div> : null}
        {actions ? <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
      </div>
    </Root>
  );
}
