"use client";

import clsx from "clsx";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "sm" | "icon" | "icon-sm";

type ButtonLook = { variant?: ButtonVariant; size?: ButtonSize };

function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md") {
  return clsx(
    "btn",
    variant === "primary" && "btn-primary",
    variant === "secondary" && "btn-secondary",
    variant === "ghost" && "btn-ghost",
    variant === "danger" && "btn-danger",
    size === "sm" && "btn-sm",
    size === "icon" && "btn-icon",
    size === "icon-sm" && "btn-icon btn-sm",
  );
}

/** Der Button der Anwendung (Klick-Aktionen im Browser). Zum Absenden eines Formulars: SubmitButton. */
export function Button({ variant = "secondary", size = "md", type = "button", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & ButtonLook) {
  return <button {...props} type={type} className={clsx(buttonClass(variant, size), className)} />;
}

/** Link im Aussehen eines Buttons. `external` für Downloads und Dateien (normaler Link statt Seitenwechsel in der App). */
export function LinkButton({
  variant = "secondary",
  size = "md",
  external,
  className,
  ...props
}: ComponentProps<typeof Link> & ButtonLook & { external?: boolean }) {
  const classes = clsx(buttonClass(variant, size), className);
  if (!external) return <Link {...props} className={classes} />;
  const { href, children, download, target, rel, title, "aria-label": ariaLabel } = props;
  return (
    <a href={String(href)} download={download} target={target} rel={rel} title={title} aria-label={ariaLabel} className={classes}>
      {children}
    </a>
  );
}

/** Submit-Button, der während des Absendens (useFormStatus) gesperrt ist und einen Spinner zeigt. */
export function SubmitButton({
  children,
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & ButtonLook) {
  const { pending } = useFormStatus();
  return (
    <button
      {...props}
      type="submit"
      disabled={pending || props.disabled}
      aria-busy={pending || undefined}
      className={clsx(buttonClass(variant, size), className)}
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

/** Submit-Button mit Browser-Rückfrage (z. B. Löschen). */
export function ConfirmSubmitButton({
  message,
  children,
  variant = "danger",
  size = "sm",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> &
  ButtonLook & {
    message: string;
    children: ReactNode;
  }) {
  const { pending } = useFormStatus();
  return (
    <button
      {...props}
      type="submit"
      disabled={pending || props.disabled}
      aria-busy={pending || undefined}
      className={clsx(buttonClass(variant, size), className)}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}
