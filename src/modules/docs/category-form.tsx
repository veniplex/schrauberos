"use client";

import { useActionState, useRef } from "react";
import { Input, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/buttons";
import { useI18n } from "@/i18n/client";
import { saveDocCategory } from "./actions";

/** Eine Zeile zum Anlegen oder Umbenennen einer Kategorie. */
export function CategoryForm({ area, initial }: { area: string; initial?: { id: string; name: string; sortOrder: number } }) {
  const { t } = useI18n();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const result = await saveDocCategory(prev, fd);
    if (result.ok && !initial) formRef.current?.reset();
    return result;
  }, {});
  return (
    <form ref={formRef} action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="area" value={area} />
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      <Input name="name" defaultValue={initial?.name} placeholder={t("docs.fields.categoryName")} aria-label={t("docs.fields.categoryName")} className="min-w-36 flex-1" maxLength={60} required />
      <Input name="sortOrder" type="number" min={0} defaultValue={initial?.sortOrder ?? 0} aria-label={t("settings.sortOrder")} className="w-20" />
      <SubmitButton size="sm" variant={initial ? "secondary" : "primary"}>
        {initial ? t("common.save") : t("common.add")}
      </SubmitButton>
      {state.error ? <span role="alert" className="text-xs text-danger-ink">{state.error}</span> : null}
    </form>
  );
}
