"use client";

import clsx from "clsx";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ComponentProps } from "react";
import { LinkPending } from "./link-pending";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "sm" | "icon" | "icon-sm";

type ButtonLook = { variant?: ButtonVariant; size?: ButtonSize };

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md") {
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
export function Button({ variant = "secondary", size = "md", type = "button", className, ...props }: ComponentProps<"button"> & ButtonLook) {
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
  if (!external) {
    const { children, ...rest } = props;
    return (
      <Link {...rest} className={classes}>
        {children}
        <LinkPending />
      </Link>
    );
  }
  const { href, children, download, target, rel, title, "aria-label": ariaLabel } = props;
  return (
    <a href={String(href)} download={download} target={target} rel={rel} title={title} aria-label={ariaLabel} className={classes}>
      {children}
    </a>
  );
}

/** Submit-Button, der während des Absendens (useFormStatus) nicht noch einmal absendet (`aria-disabled`, der Fokus bleibt) und einen Spinner zeigt. */
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
      disabled={props.disabled}
      // Beim Absenden `aria-disabled` statt `disabled`: ein gesperrter Knopf verliert den Fokus (Tastatur und Bildschirmleser landen auf <body>); ein zweiter Klick wird abgefangen
      aria-disabled={pending || props.disabled || undefined}
      aria-busy={pending || undefined}
      onClick={(event) => {
        if (pending) event.preventDefault();
        else props.onClick?.(event);
      }}
      className={clsx(buttonClass(variant, size), className)}
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}
