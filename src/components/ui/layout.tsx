import clsx from "clsx";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description ? <p className="mt-1 max-w-prose text-sm text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({
  title,
  actions,
  children,
  className,
  padded = true,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={clsx("card min-w-0", className)}>
      {title || actions ? (
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </div>
      ) : null}
      <div className={clsx(padded && "card-pad")}>{children}</div>
    </section>
  );
}

export function EmptyState({ title, hint, action }: { title: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {hint ? <p className="max-w-sm text-sm text-ink-muted">{hint}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

export function Badge({ tone = "neutral", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return <span className={clsx("badge", `badge-${tone}`, className)}>{children}</span>;
}

export function Plate({ children }: { children: ReactNode }) {
  return <span className="plate">{children}</span>;
}

export function Alert({ tone = "info", children }: { tone?: "info" | "warning" | "danger" | "success"; children: ReactNode }) {
  const toneClass = {
    info: "bg-info-bg text-info-ink",
    warning: "bg-warning-bg text-warning-ink",
    danger: "bg-danger-bg text-danger-ink",
    success: "bg-success-bg text-success-ink",
  }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={clsx("rounded-md px-3.5 py-2.5 text-sm", toneClass)}>
      {children}
    </div>
  );
}

export function DefinitionList({ items }: { items: Array<{ label: ReactNode; value: ReactNode }> }) {
  // Gestapelt statt zweispaltig: funktioniert auch in schmalen Seitenspalten
  return (
    <dl className="flex flex-col gap-3 text-sm">
      {items.map((it, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs text-ink-muted">{it.label}</dt>
          <dd className="mt-0.5 break-words">{it.value || <span className="text-ink-muted">–</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
