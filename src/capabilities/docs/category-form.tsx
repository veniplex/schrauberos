"use client";

import { Checkbox, Field, Form, FormMessage, Input } from "@/components/ui/form";
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
  initial?: { id: string; version: string; name: string; sortOrder: number; roleIds: string[] };
}) {
  const { t } = useI18n();
  return (
    <Form action={saveDocCategory} className="flex flex-col gap-2">
      <input type="hidden" name="area" value={area} />
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      {initial ? <input type="hidden" name="version" value={initial.version} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Input name="name" defaultValue={initial?.name} placeholder={t("docs.fields.categoryName")} aria-label={t("docs.fields.categoryName")} className="min-w-36 flex-1" maxLength={60} required />
        <Input name="sortOrder" type="number" min={0} defaultValue={initial?.sortOrder ?? 0} aria-label={t("common.sortOrder")} className="w-20" />
      </div>
      {roles.length > 0 ? (
        <Field label={t("docs.fields.chapterRoles")} group hint={t("docs.fields.chapterRolesHint")}>
          {roles.map((r) => (
            <Checkbox key={r.id} name="roleIds" value={r.id} defaultChecked={initial?.roleIds.includes(r.id)} label={r.name} />
          ))}
        </Field>
      ) : null}
      <div className="flex items-center gap-2">
        <SubmitButton size="sm" variant={initial ? "secondary" : "primary"}>
          {initial ? t("common.save") : t("common.add")}
        </SubmitButton>
        <FormMessage />
      </div>
    </Form>
  );
}
