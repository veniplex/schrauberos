"use client";

import { useActionState, useState } from "react";
import { type ActionState, Checkbox, Field, FormMessage, Input } from "@/components/ui/form";
import { Button, LinkButton, SubmitButton } from "@/components/ui/buttons";
import { Card } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import { saveRole } from "./actions";

export type RolePermissionSection = {
  moduleId: string;
  moduleName: string;
  groups: Array<{ group: string; label: string; keys: Array<{ key: string; label: string }>; inactive: boolean }>;
};

/** `sections` kommt vom Server (Katalog + Aktivierungsstand + Übersetzungen), das Formular kennt keine Fachlogik. */
export function RoleForm({
  initial,
  sections,
}: {
  initial: { id?: string; name: string; description: string; isAdmin: boolean; permissions: string[] };
  sections: RolePermissionSection[];
}) {
  const { t } = useI18n();
  const [state, action] = useActionState<ActionState, FormData>(saveRole, {});
  const [selected, setSelected] = useState(() => new Set(initial.permissions));
  const err = state.fieldErrors ?? {};

  const toggle = (key: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const toggleGroup = (keys: readonly string[], on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
      return next;
    });

  return (
    <form action={action} className="flex max-w-4xl flex-col gap-5">
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("roles.fields.name")} htmlFor="name" error={err.name} required>
            <Input id="name" name="name" defaultValue={initial.name} invalid={!!err.name} maxLength={60} required />
          </Field>
          <Field label={t("roles.fields.description")} htmlFor="description">
            <Input id="description" name="description" defaultValue={initial.description} maxLength={300} />
          </Field>
        </div>
      </Card>

      {initial.isAdmin ? (
        <p className="rounded-md bg-info-bg px-3.5 py-2.5 text-sm text-info-ink">{t("roles.adminNotice")}</p>
      ) : (
        <div className="flex flex-col gap-6">
          {sections.map((section) => (
            <section key={section.moduleId} aria-labelledby={`perm-module-${section.moduleId}`}>
              <h2 id={`perm-module-${section.moduleId}`} className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {section.moduleName}
              </h2>
              <div className="grid gap-4 md:grid-cols-2">
                {section.groups.map((group) => {
                  const keys = group.keys.map((k) => k.key);
                  const allOn = keys.every((k) => selected.has(k));
                  return (
                    <Card
                      key={group.group}
                      title={group.label}
                      actions={
                        <Button variant="ghost" size="sm" onClick={() => toggleGroup(keys, !allOn)}>
                          {allOn ? t("roles.selectNone") : t("roles.selectAll")}
                        </Button>
                      }
                    >
                      {group.inactive ? <p className="mb-2 text-xs text-warning-ink">{t("roles.featureInactive")}</p> : null}
                      <ul className="flex flex-col gap-2">
                        {group.keys.map(({ key, label }) => (
                          <li key={key}>
                            <Checkbox name="permission" value={key} checked={selected.has(key)} onChange={(e) => toggle(key, e.target.checked)} label={label} />
                          </li>
                        ))}
                      </ul>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <FormMessage state={state} />
      <div className="flex justify-end gap-2">
        <LinkButton href="/admin/roles">
          {t("common.cancel")}
        </LinkButton>
        <SubmitButton>{t("common.save")}</SubmitButton>
      </div>
    </form>
  );
}
