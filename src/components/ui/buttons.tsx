"use client";

import clsx from "clsx";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function buttonClass(variant: ButtonVariant = "secondary", size: "md" | "sm" | "icon" = "md") {
  return clsx(
    "btn",
    variant === "primary" && "btn-primary",
    variant === "secondary" && "btn-secondary",
    variant === "ghost" && "btn-ghost",
    variant === "danger" && "btn-danger",
    size === "sm" && "btn-sm",
    size === "icon" && "btn-icon",
  );
}

export function LinkButton({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: "md" | "sm" | "icon" }) {
  return <Link {...props} className={clsx(buttonClass(variant, size), className)} />;
}

/** Submit-Button, der während des Absendens (useFormStatus) gesperrt ist und einen Spinner zeigt. */
export function SubmitButton({
  children,
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "md" | "sm" | "icon" }) {
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
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  message: string;
  variant?: ButtonVariant;
  size?: "md" | "sm" | "icon";
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
      {children}
    </button>
  );
}
