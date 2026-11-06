import { Badge, Card } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { MODULES, featureById, featuresOfModule } from "../../catalog";

/** Seite „Katalog“ des Handbuchs: Module und Funktionen, direkt aus dem Code erzeugt (kann nicht veralten). */
export async function CatalogView() {
  const { t, td } = await getI18n();
  const nameOf = (id: string) => {
    const f = featureById(id);
    return f ? t(f.nameKey) : id;
  };
  const list = (ids: readonly string[]) => (ids.length ? ids.map(nameOf).join(", ") : t("handbook.catalog.none"));

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-ink-muted">{t("handbook.catalogDescription")}</p>
      {MODULES.map((m) => (
        <Card key={m.id} title={`${t(m.nameKey)} (${m.id})`}>
          <p className="mb-4 text-sm text-ink-muted">{t(m.descriptionKey)}</p>
          <ul className="flex flex-col gap-5">
            {featuresOfModule(m.id).map((f) => {
              const requires = "requires" in f ? f.requires : [];
              const uses = "uses" in f ? f.uses : [];
              const routes = [...new Set([...f.nav.map((n) => n.href), ...f.routes.map((r) => `/${r}`)])];
              return (
                <li key={f.id} className="border-t border-line pt-4 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">{t(f.nameKey)}</h3>
                    <code className="text-xs text-ink-muted">{`${f.module}.${f.id}`}</code>
                    {"required" in f && f.required ? <Badge>{t("handbook.catalog.required")}</Badge> : null}
                  </div>
                  <p className="mt-0.5 text-sm text-ink-muted">{t(f.descriptionKey)}</p>
                  <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[9rem_1fr]">
                    <dt className="text-ink-muted">{t("handbook.catalog.requires")}</dt>
                    <dd>{list(requires)}</dd>
                    <dt className="text-ink-muted">{t("handbook.catalog.uses")}</dt>
                    <dd>{list(uses)}</dd>
                    <dt className="text-ink-muted">{t("handbook.catalog.permissions")}</dt>
                    <dd className="flex flex-wrap gap-1">
                      {f.permissions.keys.map((k) => (
                        <code key={k} title={td(`permissions.${k}`, k)} className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">
                          {k}
                        </code>
                      ))}
                    </dd>
                    <dt className="text-ink-muted">{t("handbook.catalog.routes")}</dt>
                    <dd className="flex flex-wrap gap-1">
                      {routes.length
                        ? routes.map((r) => (
                            <code key={r} className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">
                              {r}
                            </code>
                          ))
                        : t("handbook.catalog.none")}
                    </dd>
                  </dl>
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
    </div>
  );
}
