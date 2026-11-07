"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ComponentProps, type ReactNode } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "./buttons";
import { LinkPending } from "./link-pending";

/**
 * Aufklappfläche am Knopf (Konto-Menü, „Neu“ …) als **Popover nach dem Offenlegungsmuster**, nicht als ARIA-Menü: Der Knopf trägt `aria-expanded`/`aria-controls`, die Fläche
 * enthält gewöhnliche Links und Knöpfe, die man mit Tab erreicht – kein `role="menu"`, das Pfeiltasten und eine eigene Fokusverwaltung versprechen würde.
 * Schließt bei Klick daneben, Escape (der **Fokus geht zurück an den Knopf**), beim Verlassen per Tab und bei Seitenwechsel.
 * `placement`: wohin die Fläche aufgeht (nach unten oder – am unteren Rand der Seitenleiste – nach oben).
 */
export function Menu({
  trigger,
  label,
  children,
  placement = "down",
  align = "start",
  variant = "ghost",
  size = "md",
  block,
  panelClassName,
  className,
}: {
  /** Inhalt des Knopfes */
  trigger: ReactNode;
  /** Zugänglicher Name des Knopfes */
  label: string;
  children: ReactNode;
  placement?: "down" | "up";
  /** Ausrichtung der Fläche am Knopf */
  align?: "start" | "end";
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Knopf über die ganze Breite (Benutzer-Menü) */
  block?: boolean;
  panelClassName?: string;
  className?: string;
}) {
  const [openAt, setOpenAt] = useState<string | null>(null);
  const pathname = usePathname();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const open = openAt === pathname; // ein Seitenwechsel schließt die Fläche von selbst

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setOpenAt(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpenAt(null);
      button.current?.focus();
    };
    const leave = (event: FocusEvent) => {
      // Der Fokus verlässt die Fläche (Tab, Klick in die Seite): schließen, ohne ihn zurückzuholen
      if (event.relatedTarget && !root.current?.contains(event.relatedTarget as Node)) setOpenAt(null);
    };
    const element = root.current;
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    element?.addEventListener("focusout", leave);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      element?.removeEventListener("focusout", leave);
    };
  }, [open]);

  return (
    <div ref={root} className={clsx("relative", className)}>
      <Button
        ref={button}
        variant={variant}
        size={size}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={label}
        className={clsx(block && "w-full justify-start")}
        onClick={() => setOpenAt(open ? null : pathname)}
      >
        {trigger}
      </Button>
      {open ? (
        <div id={panelId} className={clsx("absolute z-30 w-60 rounded-lg border border-line bg-surface p-1 shadow-pop", align === "end" ? "right-0" : "left-0", placement === "up" ? "bottom-full mb-1" : "top-full mt-1", panelClassName)}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

const itemClass = "relative flex min-h-(--tap) w-full items-center gap-2 rounded-md px-3 text-left text-sm hover:bg-surface-hover";

export function MenuHeader({ children }: { children: ReactNode }) {
  return <div className="mb-1 border-b border-line px-3 py-2">{children}</div>;
}

export function MenuLink({ className, children, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link {...props} className={clsx(itemClass, className)}>
      {children}
      <LinkPending />
    </Link>
  );
}

/** Eintrag, der ein Formular absendet (z. B. Abmelden). */
export function MenuSubmit({ className, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">) {
  return <button {...props} type="submit" className={clsx(itemClass, className)} />;
}
