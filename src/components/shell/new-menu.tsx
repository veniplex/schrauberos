"use client";

import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { Menu, MenuLink } from "@/components/ui/menu";

export type NewAction = { id: string; href: string; label: string; icon: ReactNode };

/**
 * Globale Schaltfläche „Neu“: Die Einträge liefern die Funktionen (`quickActions` in der `feature.ts`, gefiltert nach Aktivierung und Recht); die Plattform kennt keine Funktion.
 * Auf kleinen Bildschirmen nur das Symbol (der Knopf bleibt 44 px groß, die Beschriftung ist der zugängliche Name).
 */
export function NewMenu({ label, actions }: { label: string; actions: NewAction[] }) {
  if (actions.length === 0) return null;
  return (
    <Menu
      label={label}
      variant="primary"
      align="end"
      panelClassName="w-64"
      trigger={
        <>
          <Plus className="size-4" aria-hidden />
          <span className="hidden sm:inline">{label}</span>
        </>
      }
    >
      <ul>
        {actions.map((action) => (
          <li key={action.id}>
            <MenuLink href={action.href}>
              {action.icon}
              {action.label}
            </MenuLink>
          </li>
        ))}
      </ul>
    </Menu>
  );
}
