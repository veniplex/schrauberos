"use client";

import { startTransition, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { FormAction } from "@/components/ui/form-frame";
import { useInlineAction } from "@/components/ui/inline-action";
import { useI18n } from "@/i18n/client";
import { setTireSetStatus } from "./actions";
import { suggestedStockStatus } from "./domain";

/**
 * Vorschlag „Satz jetzt ein-/ausbuchen?“ nach einem erledigten Wechseltermin: ein Dialog mit Bestätigung – **gebucht wird erst auf Klick** (nie automatisch). Ein gelagerter Satz
 * wird ausgebucht (beim Kunden montiert), ein ausgelagerter wieder eingebucht; `version` ist der Stand beim Anzeigen (hat jemand den Satz inzwischen umgebucht, meldet die Aktion den
 * Konflikt statt doppelt zu buchen). „Später“ schließt ohne Wirkung – der Satz lässt sich jederzeit auf seiner Seite buchen. Die Seite der Termine setzt den Dialog zusammen
 * und reicht ihn der Terminkarte durch (`QuickStatus` zeigt ihn erst nach „Fertig“); ohne Recht `tires.stock` wird er gar nicht erst gebaut.
 */
export function TireStockPrompt({ id, version, status, label }: { id: string; version: string; status: string; label: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const [, dispatch] = useInlineAction(setTireSetStatus as unknown as FormAction);
  const target = suggestedStockStatus(status);
  if (!target) return null;
  const out = target === "mounted";

  return (
    <ConfirmDialog
      open={open}
      variant="primary"
      title={t(out ? "tires.stock.outTitle" : "tires.stock.inTitle")}
      description={t(out ? "tires.stock.outText" : "tires.stock.inText", { set: label })}
      confirmLabel={t(out ? "tires.stock.confirmOut" : "tires.stock.confirmIn")}
      cancelLabel={t("tires.stock.later")}
      onCancel={() => setOpen(false)}
      onConfirm={() => {
        setOpen(false);
        const data = new FormData();
        data.set("id", id);
        data.set("version", version);
        data.set("status", target);
        startTransition(() => dispatch(data));
      }}
    />
  );
}
