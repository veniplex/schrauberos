"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ComponentProps, type ReactNode } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "./buttons";
import { LinkPending } from "./link-pending";

/**
 * Aufklappmenü (Konto-Menü …). Schließt bei Klick daneben, Escape und Seitenwechsel.
 * `placement`: wohin das Menü aufgeht (nach unten oder – am unteren Rand der Seitenleiste – nach oben).
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
  /** Ausrichtung des Menüs am Knopf */
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
  const open = openAt === pathname; // ein Seitenwechsel schließt das Menü von selbst

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setOpenAt(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={root} className={clsx("relative", className)}>
      <Button variant={variant} size={size} aria-haspopup="menu" aria-expanded={open} aria-label={label} className={clsx(block && "w-full justify-start")} onClick={() => setOpenAt(open ? null : pathname)}>
        {trigger}
      </Button>
      {open ? (
        <div role="menu" className={clsx("absolute z-30 w-60 rounded-lg border border-line bg-surface p-1 shadow-pop", align === "end" ? "right-0" : "left-0", placement === "up" ? "bottom-full mb-1" : "top-full mt-1", panelClassName)}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

const itemClass = "flex min-h-(--tap) w-full items-center gap-2 rounded-md px-3 text-left text-sm hover:bg-surface-hover";

export function MenuHeader({ children }: { children: ReactNode }) {
  return <div className="mb-1 border-b border-line px-3 py-2">{children}</div>;
}

export function MenuLink({ className, children, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link role="menuitem" {...props} className={clsx(itemClass, className)}>
      {children}
      <LinkPending />
    </Link>
  );
}

/** Menüeintrag, der ein Formular absendet (z. B. Abmelden). */
export function MenuSubmit({ className, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">) {
  return <button role="menuitem" {...props} type="submit" className={clsx(itemClass, className)} />;
}
