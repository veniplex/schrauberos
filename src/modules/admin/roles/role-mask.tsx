"use client";

import { useMemo, useState } from "react";
import { Checkbox, SearchInput } from "@/components/ui/form";
import { Button } from "@/components/ui/buttons";
import { Disclosure } from "@/components/ui/disclosure";
import { Badge, Card } from "@/components/ui/layout";
import { filterMask, rolePreview, togglePermission, toggleGroupPermissions, type MaskGroup, type MaskSection, type PreviewData } from "@/lib/role-mask";
import { useI18n } from "@/i18n/client";

export type RoleTemplateOption = { id: string; name: string; description: string; permissions: string[] };

/**
 * Auswahl der Rechte einer Rolle (Teil der Rollenmaske, `RoleForm`). `sections` kommt vom Server (Katalog + Aktivierungsstand + Übersetzungen), die Maske kennt keine Fachlogik.
 * Kurzbeschreibung je Recht, einklappbare Gruppen (offen sind die mit gewählten Rechten), Suche, Rollenvorlagen, ausgeschaltete Funktionen eingeklappt in einem eigenen Bereich je Modul
 * und die Vorschau „Was sieht diese Rolle?“. **Alle** Kontrollkästchen bleiben im Dokument (zugeklappte Gruppen und Suchtreffer blenden nur aus): Gesendet wird die ganze Auswahl,
 * nicht nur, was gerade sichtbar ist. `onTemplate` meldet die übernommene Vorlage (das Formular füllt damit leeren Namen und Beschreibung).
 */
export function RoleMask({
  initialPermissions,
  sections,
  lockedPermissions,
  templates,
  preview,
  onTemplate,
}: {
  initialPermissions: string[];
  sections: MaskSection[];
  /** Rechte, die der angemeldete Benutzer nicht vergeben oder entziehen darf (nicht Teil seiner eigenen Rechte oder nur für Administratoren) */
  lockedPermissions: string[];
  templates: RoleTemplateOption[];
  preview: PreviewData;
  onTemplate?: (template: RoleTemplateOption) => void;
}) {
  const { t, tp } = useI18n();
  const [selected, setSelected] = useState(() => new Set(initialPermissions));
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  // Gruppen, die aufgeklappt sind; zu Beginn die mit gewählten Rechten (bei einer neuen Rolle also keine)
  const [open, setOpen] = useState(() => new Set(sections.flatMap((s) => s.groups.filter((g) => g.keys.some((k) => initialPermissions.includes(k.key))).map((g) => g.group))));

  const locked = useMemo(() => new Set(lockedPermissions), [lockedPermissions]);
  // Regeln der Maske („Bearbeiten“ setzt „Ansehen“ …): src/lib/role-mask.ts, getestet
  const toggle = (key: string, on: boolean, groupKeys: readonly string[]) => setSelected((s) => togglePermission(s, key, on, groupKeys, locked));
  const toggleGroup = (keys: readonly string[], on: boolean) => setSelected((s) => toggleGroupPermissions(s, keys, on, locked));

  const matched = useMemo(() => filterMask(sections, query), [sections, query]);
  const visibleKeys = useMemo(() => new Set(matched.flatMap((s) => s.groups.flatMap((g) => g.keys.map((k) => k.key)))), [matched]);
  const searching = query.trim() !== "";
  const allGroups = sections.flatMap((s) => s.groups.map((g) => g.group));
  const total = sections.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.keys.length, 0), 0);
  const result = useMemo(() => rolePreview(selected, preview), [selected, preview]);

  const applyTemplate = (template: RoleTemplateOption) => {
    // Die Vorlage ersetzt die Auswahl; was die Person nicht vergeben oder entziehen darf, bleibt wie es war
    const next = new Set(template.permissions.filter((p) => !locked.has(p)));
    for (const p of selected) if (locked.has(p)) next.add(p);
    setSelected(next);
    setOpen(new Set(sections.flatMap((s) => s.groups.filter((g) => g.keys.some((k) => next.has(k.key))).map((g) => g.group))));
    onTemplate?.(template);
    setApplied(t("roles.templates.applied", { name: template.name, count: template.permissions.filter((p) => !locked.has(p)).length }));
  };

  const groupPanel = (group: MaskGroup) => {
    const keys = group.keys.map((k) => k.key);
    const free = keys.filter((k) => !locked.has(k));
    const allOn = free.every((k) => selected.has(k));
    const count = keys.filter((k) => selected.has(k)).length;
    const shown = group.keys.some((k) => visibleKeys.has(k.key));
    return (
      <div key={group.group} hidden={!shown}>
        <Disclosure
          title={group.label}
          description={t("roles.mask.groupSelected", { selected: count, total: keys.length })}
          headingLevel={3}
          open={searching ? true : open.has(group.group)}
          onOpenChange={(next) => setOpen((o) => new Set(next ? [...o, group.group] : [...o].filter((g) => g !== group.group)))}
          actions={
            free.length > 0 ? (
              <Button variant="ghost" size="sm" onClick={() => toggleGroup(keys, !allOn)}>
                {allOn ? t("roles.selectNone") : t("roles.selectAll")}
                <span className="sr-only"> – {group.label}</span>
              </Button>
            ) : null
          }
        >
          <ul className="flex flex-col gap-1 px-1 pb-2 pt-1">
            {group.keys.map(({ key, label, hint, mark }) => (
              <li key={key} hidden={!visibleKeys.has(key)}>
                <Checkbox
                  name={locked.has(key) ? undefined : "permission"}
                  value={key}
                  checked={selected.has(key)}
                  disabled={locked.has(key)}
                  onChange={(e) => toggle(key, e.target.checked, keys)}
                  label={
                    <>
                      {label}
                      {mark ? (
                        <Badge tone="warning" className="ml-2 align-middle">
                          {mark}
                        </Badge>
                      ) : null}
                    </>
                  }
                  hint={
                    <>
                      {hint}
                      {locked.has(key) ? <span className="block">{t("roles.lockedRight")}</span> : null}
                    </>
                  }
                />
                {/* gesperrte, aber vorhandene Rechte bleiben erhalten (der Server prüft nur die Differenz) */}
                {locked.has(key) && selected.has(key) ? <input type="hidden" name="permission" value={key} /> : null}
              </li>
            ))}
          </ul>
        </Disclosure>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="flex min-w-0 flex-col gap-5">
        <Card title={t("roles.templates.title")}>
          <p className="mb-3 text-sm text-ink-muted">{t("roles.templates.hint")}</p>
          <div className="flex flex-wrap gap-2">
            {templates.map((template) => (
              <Button key={template.id} variant="secondary" title={template.description} onClick={() => applyTemplate(template)}>
                {template.name}
                <span className="sr-only"> – {t("roles.templates.apply")}</span>
              </Button>
            ))}
          </div>
          <p role="status" className="mt-2 text-sm text-ink-muted">
            {applied}
          </p>
        </Card>

        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              // Enter in der Suche darf die Rolle nicht speichern
              onKeyDown={(e) => {
                if (e.key === "Enter") e.preventDefault();
              }}
              data-no-draft
              placeholder={t("roles.mask.searchPlaceholder")}
              aria-label={t("roles.mask.searchLabel")}
              className="min-w-56 flex-1"
            />
            <Button variant="ghost" onClick={() => setOpen(new Set(allGroups))}>
              {t("roles.mask.expandAll")}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(new Set())}>
              {t("roles.mask.collapseAll")}
            </Button>
          </div>
          <p role="status" className="mt-2 text-sm text-ink-muted">
            {searching ? (visibleKeys.size === 0 ? t("roles.mask.noMatches") : tp("roles.mask.matches", visibleKeys.size)) : t("roles.mask.selectedTotal", { selected: selected.size, total })}
          </p>
        </Card>

        <div className="flex flex-col gap-6">
          {sections.map((section) => {
            const active = section.groups.filter((g) => !g.inactive);
            const inactive = section.groups.filter((g) => g.inactive);
            const sectionShown = matched.some((s) => s.moduleId === section.moduleId);
            return (
              <section key={section.moduleId} aria-labelledby={`perm-module-${section.moduleId}`} hidden={!sectionShown}>
                <h2 id={`perm-module-${section.moduleId}`} className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  {section.moduleName}
                </h2>
                <div className="flex flex-col gap-3">
                  {active.map((g) => groupPanel(g))}
                  {inactive.length > 0 ? (
                    <div hidden={!inactive.some((g) => g.keys.some((k) => visibleKeys.has(k.key)))}>
                      <Disclosure title={tp("roles.mask.inactiveTitle", inactive.length)} description={t("roles.mask.inactiveHint")} open={searching ? true : undefined}>
                        <div className="flex flex-col gap-3 pt-2">{inactive.map((g) => groupPanel(g))}</div>
                      </Disclosure>
                    </div>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <aside aria-labelledby="role-preview" className="min-w-0 xl:sticky xl:top-(--sticky-top) xl:self-start">
        <Card>
          <h2 id="role-preview" className="text-sm font-semibold">
            {t("roles.preview.title")}
          </h2>
          <p className="mt-0.5 text-xs text-ink-muted">{t("roles.preview.hint")}</p>
          <div className="mt-3 flex flex-col gap-4 text-sm" aria-live="polite">
            {[
              { id: "nav", title: t("roles.preview.navigation"), entries: result.nav },
              { id: "widgets", title: t("roles.preview.dashboard"), entries: result.widgets },
              { id: "actions", title: t("roles.preview.actions"), entries: result.actions },
            ].map(({ id, title, entries }) => (
              <div key={id}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</h3>
                {entries.length === 0 ? (
                  <p className="mt-1 text-ink-muted">{t("roles.preview.nothing")}</p>
                ) : (
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {entries.map((e) => (
                      <li key={e.id}>
                        <Badge>{e.label}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            {result.nav.length + result.widgets.length + result.actions.length === 0 ? <p className="text-ink-muted">{t("roles.preview.onlyOverview")}</p> : null}
            {result.waiting > 0 ? <p className="text-xs text-warning-ink">{tp("roles.preview.waiting", result.waiting)}</p> : null}
          </div>
        </Card>
      </aside>
    </div>
  );
}
