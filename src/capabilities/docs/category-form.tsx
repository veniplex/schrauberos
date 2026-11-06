"use client";

import { useActionState, useRef } from "react";
import { Checkbox, FieldError, FieldHint, FieldLabel, Input, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/buttons";
import { useI18n } from "@/i18n/client";
import { saveDocCategory } from "./actions";

export type ChapterRole = { id: string; name: string };

/** Anlegen oder Ändern eines Kapitels: Name, Reihenfolge und – optional – die Rollen, die es lesen dürfen. */
export function CategoryForm({
  area,
  roles,
  initial,
}: {
  area: string;
  roles: ChapterRole[];
  initial?: { id: string; name: string; sortOrder: number; roleIds: string[] };
}) {
  const { t } = useI18n();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const result = await saveDocCategory(prev, fd);
    if (result.ok && !initial) formRef.current?.reset();
    return result;
  }, {});
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-2">
      <input type="hidden" name="area" value={area} />
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Input name="name" defaultValue={initial?.name} placeholder={t("docs.fields.categoryName")} aria-label={t("docs.fields.categoryName")} className="min-w-36 flex-1" maxLength={60} required />
        <Input name="sortOrder" type="number" min={0} defaultValue={initial?.sortOrder ?? 0} aria-label={t("common.sortOrder")} className="w-20" />
      </div>
      {roles.length > 0 ? (
        <fieldset className="flex flex-col gap-1">
          <FieldLabel as="legend">{t("docs.fields.chapterRoles")}</FieldLabel>
          {roles.map((r) => (
            <Checkbox key={r.id} name="roleIds" value={r.id} defaultChecked={initial?.roleIds.includes(r.id)} label={r.name} />
          ))}
          <FieldHint>{t("docs.fields.chapterRolesHint")}</FieldHint>
        </fieldset>
      ) : null}
      <div className="flex items-center gap-2">
        <SubmitButton size="sm" variant={initial ? "secondary" : "primary"}>
          {initial ? t("common.save") : t("common.add")}
        </SubmitButton>
        {state.error ? <FieldError as="span">{state.error}</FieldError> : null}
      </div>
    </form>
  );
}
