import clsx from "clsx";
import Link from "next/link";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { Button } from "./buttons";
import { LinkPending } from "./link-pending";

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

/**
 * Die Karte. Mit `title`/`actions` bekommt sie einen Kopf; `padded={false}` für Inhalte, die bis an den Rand reichen (Tabellen, Listen).
 * `className` geht an die Karte selbst – ohne Kopf gilt er also auch für den Inhalt (z. B. `grid gap-3`).
 */
export function Card({
  title,
  actions,
  children,
  className,
  padded = true,
  as: Tag = "section",
  ...rest
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  padded?: boolean;
  as?: "section" | "article" | "aside" | "div";
} & Omit<HTMLAttributes<HTMLElement>, "title">) {
  const hasHeader = Boolean(title || actions);
  return (
    <Tag {...rest} className={clsx("card min-w-0", padded && !hasHeader && "card-pad", className)}>
      {hasHeader ? (
        <>
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold">{title}</h2>
            {actions}
          </div>
          <div className={clsx(padded && "card-pad")}>{children}</div>
        </>
      ) : (
        children
      )}
    </Tag>
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

/** Umschaltbarer Filter in Chip-Form (z. B. Status-Filter über einer Liste), als Link. */
export function ChipLink({ active, className, ...props }: ComponentProps<typeof Link> & { active?: boolean }) {
  const { children, ...rest } = props;
  return (
    <Link {...rest} aria-current={active ? "true" : undefined} className={clsx("badge px-3 py-1 text-sm", active ? "badge-accent" : "badge-neutral hover:bg-surface-hover", className)}>
      {children}
      <LinkPending className="size-3" />
    </Link>
  );
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

/** Tabelle mit waagerechtem Scrollen auf schmalen Bildschirmen. `className` geht an die Tabelle (z. B. Mindestbreite), `scrollClassName` an den Rahmen. */
export function Table({
  className,
  scrollClassName,
  variant = "list",
  children,
}: {
  className?: string;
  scrollClassName?: string;
  /** `list` = Datenliste mit Kopfzeile; `grid` = Raster ohne Standard-Zellenstil (Monatskalender) */
  variant?: "list" | "grid";
  children: ReactNode;
}) {
  return (
    <div className={clsx("overflow-x-auto", scrollClassName)}>
      <table className={clsx(variant === "list" ? "table" : "w-full border-collapse text-xs", className)}>{children}</table>
    </div>
  );
}

/** Link im Fließtext/Kartenkopf („Alle anzeigen“, Verweise auf andere Seiten). */
export function TextLink({ className, children, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link {...props} className={clsx("text-accent-text hover:underline", className)}>
      {children}
      <LinkPending className="ml-1 inline size-3.5 align-[-0.1em]" />
    </Link>
  );
}

/**
 * Filterleiste über einer Liste (GET-Formular): Suchfeld, Auswahlfelder … als Kinder, der Absenden-Knopf kommt von selbst dazu.
 * `columns` ist die Spaltenaufteilung ab `sm` (Tailwind, z. B. "sm:grid-cols-[minmax(0,1fr)_10rem_auto]").
 */
export function FilterBar({ columns, submitLabel, children }: { columns: string; submitLabel: string; children: ReactNode }) {
  return (
    <form method="get" role="search" className={clsx("card card-pad mb-5 grid gap-3", columns)}>
      {children}
      <Button type="submit" variant="secondary">
        {submitLabel}
      </Button>
    </form>
  );
}

/** Eintrag einer senkrechten Navigation (Kapitelliste, Hilfe, Seitenleiste). `count` zeigt eine Zahl am Zeilenende. */
export function NavLink({
  active,
  icon,
  count,
  className,
  children,
  ...props
}: ComponentProps<typeof Link> & { active?: boolean; icon?: ReactNode; count?: number | null }) {
  return (
    <Link
      {...props}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "flex min-h-9 items-center gap-3 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-accent-subtle text-accent-text" : "text-ink-muted hover:bg-surface-hover hover:text-ink",
        className,
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count != null ? <span className="text-xs tabular">{count}</span> : null}
      <LinkPending />
    </Link>
  );
}

/** Karte, die als Ganzes ein Link ist (Übersichtskacheln, Trefferlisten). */
export function CardLink({ className, children, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link {...props} className={clsx("card card-pad relative block transition-colors hover:bg-surface-hover", className)}>
      {children}
      <LinkPending className="absolute right-3 top-3" />
    </Link>
  );
}

/** Platzhalter für noch ladende Inhalte (Ladeseiten, Widgets). Nur dekorativ – die Ladeseite sagt „Wird geladen“ selbst an. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx("animate-pulse rounded-md bg-surface-2", className)} />;
}
