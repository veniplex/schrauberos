import clsx from "clsx";
import Link from "next/link";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import type { StatusTone } from "@/lib/status-tone";
import { LinkPending } from "./link-pending";

/**
 * Die Karte. Mit `title`/`actions` bekommt sie einen Kopf; `padded={false}` für Inhalte, die bis an den Rand reichen (Tabellen, Listen).
 * `className` geht an die Karte selbst – ohne Kopf gilt er also auch für den Inhalt (z. B. `grid gap-3`).
 * `headingLevel`: Ebene der Kartenüberschrift – 2 (Standard), in einem Abschnitt unter einer eigenen `h2` (Dashboard-Module, Karten in Gruppen) 3.
 */
export function Card({
  title,
  actions,
  children,
  className,
  padded = true,
  as: Tag = "section",
  headingLevel = 2,
  ...rest
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  padded?: boolean;
  as?: "section" | "article" | "aside" | "div";
  headingLevel?: 2 | 3;
} & Omit<HTMLAttributes<HTMLElement>, "title">) {
  const hasHeader = Boolean(title || actions);
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <Tag {...rest} className={clsx("card min-w-0", padded && !hasHeader && "card-pad", className)}>
      {hasHeader ? (
        <>
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
            <Heading className="text-sm font-semibold">{title}</Heading>
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

export type BadgeTone = StatusTone;
export type { StatusTone };

/** Marke ohne Zustandsbedeutung (Kennzeichnungen wie „VLAN 10“, „Werbas“, Rolle). Zustände gehören in `StatusBadge`. */
export function Badge({ tone = "neutral", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return <span className={clsx("badge", `badge-${tone}`, className)}>{children}</span>;
}

const STATUS_ICON = { success: CircleCheck, warning: TriangleAlert, danger: CircleAlert, info: Info } as const;

/**
 * Zustandsmarke. **Konvention:** grün = in Ordnung/erledigt, gelb = Aufmerksamkeit/bald fällig, rot = Fehler/überfällig/abgelaufen, blau = Information/in Arbeit,
 * grau = neutral/inaktiv, Akzent = Kennzeichnung. Grün, Gelb, Rot und Blau tragen zusätzlich ein Symbol, damit die Bedeutung nicht allein an der Farbe hängt.
 * Welcher Zustand welchen Ton bekommt, legt die Funktion in ihrer `status-tone.ts` fest (typisiert über die Zustandswerte, geprüft in `status-tone.test.ts`) – nie am Aufrufort.
 */
export function StatusBadge({ tone, children, className }: { tone: StatusTone; children: ReactNode; className?: string }) {
  const Icon = tone in STATUS_ICON ? STATUS_ICON[tone as keyof typeof STATUS_ICON] : null;
  return (
    <span className={clsx("badge", `badge-${tone}`, className)}>
      {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden /> : null}
      {children}
    </span>
  );
}

/** Umschaltbarer Filter in Chip-Form (z. B. Status-Filter über einer Liste), als Link. */
export function ChipLink({ active, className, ...props }: ComponentProps<typeof Link> & { active?: boolean }) {
  const { children, ...rest } = props;
  return (
    <Link {...rest} aria-current={active ? "true" : undefined} className={clsx("badge relative min-h-(--tap-chip) px-3 py-1 text-sm", active ? "badge-accent" : "badge-neutral hover:bg-surface-hover", className)}>
      {children}
      <LinkPending className="absolute right-0.5 top-1/2 size-3 -translate-y-1/2" />
    </Link>
  );
}

export function Plate({ children }: { children: ReactNode }) {
  return <span className="plate">{children}</span>;
}

/**
 * Hinweisfeld (Information, Warnung, Fehler, Erfolg) – für jeden Hinweis in der Oberfläche, nie handgebaut.
 * `live={false}`: ohne eigene Live-Region-Rolle – nur wenn ein umgebender Container (immer im DOM, `aria-live`) die Ansage übernimmt, z. B. der Meldungsbereich
 * im Anwendungsrahmen (`FlashNotice`); eine erst beim Auftauchen eingefügte Rolle wird von Screenreadern oft nicht angesagt.
 * `icon`: ein eigenes Symbol vor dem Text (sonst keines). `ref`/`tabIndex`/`data-*`: wie bei einem `div` (Fehlerzusammenfassung).
 */
export function Alert({
  tone = "info",
  live = true,
  icon,
  className,
  children,
  ...rest
}: { tone?: "info" | "warning" | "danger" | "success"; live?: boolean; icon?: ReactNode; className?: string; children: ReactNode } & Omit<ComponentProps<"div">, "className" | "children">) {
  const toneClass = {
    info: "bg-info-bg text-info-ink",
    warning: "bg-warning-bg text-warning-ink",
    danger: "bg-danger-bg text-danger-ink",
    success: "bg-success-bg text-success-ink",
  }[tone];
  return (
    <div role={rest.role ?? (live ? (tone === "danger" ? "alert" : "status") : undefined)} {...rest} className={clsx("rounded-md px-3.5 py-2.5 text-sm", icon ? "flex items-start gap-2" : null, toneClass, className)}>
      {icon}
      {icon ? <div className="min-w-0 flex-1">{children}</div> : children}
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

/**
 * Einfache Tabelle für kleine, feste Inhalte (Kalenderraster, Detail-Unterlisten). Datenlisten mit Zeilenlink, Sortierung, Kartenansicht und Seiten: `DataTable`.
 * Mit waagerechtem Scrollen auf schmalen Bildschirmen (der Rahmen ist per Tastatur fokussierbar, sonst erreicht niemand den verdeckten Teil).
 * `caption` benennt die Tabelle für Hilfstechnik (nicht sichtbar). `className` geht an die Tabelle (z. B. Mindestbreite), `scrollClassName` an den Rahmen.
 */
export function Table({
  className,
  scrollClassName,
  variant = "list",
  caption,
  children,
}: {
  className?: string;
  scrollClassName?: string;
  /** `list` = Datenliste mit Kopfzeile; `grid` = Raster ohne Standard-Zellenstil (Monatskalender) */
  variant?: "list" | "grid";
  caption?: string;
  children: ReactNode;
}) {
  return (
    <div className={clsx("overflow-x-auto", scrollClassName)} {...(caption ? { tabIndex: 0, role: "region", "aria-label": caption } : {})}>
      <table className={clsx(variant === "list" ? "table" : "w-full border-collapse text-xs", className)}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

/**
 * Link im Fließtext/Kartenkopf („Alle anzeigen“, Verweise auf andere Seiten): immer unterstrichen (Farbe allein unterscheidet einen Link nicht),
 * mit Mindestziel bei Touch. `external`: normaler Verweis (`mailto:`, Datei, fremde Seite) statt Seitenwechsel in der App.
 */
export function TextLink({ className, children, external, ...props }: ComponentProps<typeof Link> & { external?: boolean }) {
  const classes = clsx("relative inline-flex min-h-(--tap-row) min-w-(--tap-row) items-center text-accent-text underline underline-offset-2 hover:decoration-2", className);
  if (external) {
    const { href, target, rel, title, download, "aria-label": ariaLabel } = props;
    return (
      <a href={String(href)} target={target} rel={rel} title={title} download={download} aria-label={ariaLabel} className={classes}>
        {children}
      </a>
    );
  }
  return (
    <Link {...props} className={classes}>
      {children}
      <LinkPending className="absolute left-full top-1/2 ml-1 size-3.5 -translate-y-1/2" />
    </Link>
  );
}

const STAT_TONE = { success: "text-success-ink", warning: "text-warning-ink", danger: "text-danger-ink", info: "text-info-ink" } as const;

/**
 * Kennzahl (Übersichtskacheln, Summen): Beschriftung, großer Wert, optional eine Zeile darunter. Mit `href` ist die ganze Kachel ein Link.
 * `tone` färbt den Wert (Konvention wie `StatusBadge`).
 */
export function StatCard({
  label,
  value,
  sub,
  tone,
  href,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "success" | "warning" | "danger" | "info";
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <p className="text-sm text-ink-muted">{label}</p>
      <p className={clsx("mt-1 text-2xl font-semibold tabular", tone && STAT_TONE[tone])}>{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-ink-muted">{sub}</p> : null}
    </>
  );
  if (href) {
    return (
      <CardLink href={href} className={className}>
        {body}
      </CardLink>
    );
  }
  return (
    <Card as="div" className={className}>
      {body}
    </Card>
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
        "relative flex min-h-(--tap) items-center gap-3 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
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
      <LinkPending className="absolute right-3 top-3 size-4" />
    </Link>
  );
}

/**
 * Gefahrenbereich am Ende einer Detailseite: das unwiderrufliche Löschen (`ConfirmSubmitButton`) steht abgesetzt von den gewöhnlichen Aktionen, mit eigener Überschrift und – wenn nötig –
 * einem Satz, warum oder wann das nicht geht (`children` ist dann Text statt Formular).
 */
export function DangerZone({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx("min-w-0 rounded-lg border border-danger-ink/40 p-4", className)}>
      <h2 className="mb-3 text-sm font-semibold text-danger-ink">{title}</h2>
      {children}
    </section>
  );
}

/** Platzhalter für noch ladende Inhalte (Ladeseiten, Widgets). Nur dekorativ – die Ladeseite sagt „Wird geladen“ selbst an. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx("animate-pulse rounded-md bg-surface-2", className)} />;
}
