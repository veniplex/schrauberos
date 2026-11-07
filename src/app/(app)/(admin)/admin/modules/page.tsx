import type { Metadata } from "next";
import { Alert, Badge, StatusBadge } from "@/components/ui/layout";
import { Disclosure } from "@/components/ui/disclosure";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitSwitch } from "@/components/ui/switch";
import { getI18n } from "@/i18n/server";
import { requirePermission } from "@/server/auth/session";
import { FEATURES, MODULES, featureById, featuresOfModule } from "@/modules/catalog";
import { dependentsOf, featureKey, featureStatus, moduleOn as isModuleOn, type FeatureStatus } from "@/modules/catalog-logic";
import { getOverrides } from "@/modules/features";
import { setEnabled } from "@/modules/admin/modules/actions";
import { FEATURE_STATE_TONE } from "@/modules/admin/modules/status-tone";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("modules.title") };
}

const LABEL = { on: "modules.status.on", off: "modules.status.off", "module-off": "modules.status.moduleOff", blocked: "modules.status.blocked" } as const;

export default async function ModulesPage() {
  await requirePermission("modules.manage");
  const [{ t, tp }, overrides] = await Promise.all([getI18n(), getOverrides()]);

  const nameOf = (id: string) => {
    const f = featureById(id);
    return f ? t(f.nameKey) : id;
  };
  const names = (ids: readonly string[]) => ids.map(nameOf).join(", ");
  /** Abhängigkeiten in Kompaktdarstellung: eine Zeile je Art, die Funktionen als Marken – lesbar statt Fließtext. */
  const deps = (label: string, ids: readonly string[]) =>
    ids.length === 0 ? null : (
      <p className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium">{label}:</span>
        {ids.map((id) => (
          <Badge key={id}>{nameOf(id)}</Badge>
        ))}
      </p>
    );

  /**
   * Ein-/Ausschalter als Formular: Der Schalter trägt den neuen Zustand, das Ausschalten fragt vorher nach (Folgen für abhängige Funktionen), danach meldet ein Toast „Ein-/Ausgeschaltet“.
   * `label` benennt Modul oder Funktion (für Titel der Rückfrage und zugänglichen Namen).
   */
  const toggle = (key: string, on: boolean, label: string, confirm: string) => (
    <form action={setEnabled}>
      <input type="hidden" name="key" value={key} />
      <input type="hidden" name="enabled" value={String(!on)} />
      <SubmitSwitch checked={on} label={label} confirm={{ title: `${t("modules.turnOff")}: ${label}?`, message: confirm, confirmLabel: t("modules.turnOff") }} />
    </form>
  );

  return (
    <>
      <PageHeader help="admin.modules" title={t("modules.title")} description={t("modules.description")} />
      <div className="flex max-w-4xl flex-col gap-6">
        <Alert tone="info">{t("modules.platformNote")}</Alert>
        {/* Die Verwaltung gehört zur Plattform (Pflichtmodul) und ist nicht schaltbar – hier nur die schaltbaren Module */}
        {MODULES.filter((m) => !("required" in m && m.required)).map((m) => {
          const features = featuresOfModule(m.id);
          const moduleRequired = "required" in m && m.required;
          const moduleOn = isModuleOn(m, overrides);
          return (
            <Disclosure
              key={m.id}
              variant="card"
              headingLevel={2}
              defaultOpen={moduleOn}
              title={t(m.nameKey)}
              description={
                <>
                  {t(m.descriptionKey)} <span className="text-xs">· {tp("modules.featureCount", features.length)}</span>
                </>
              }
              actions={
                moduleRequired ? (
                  <Badge>{t("modules.required")}</Badge>
                ) : (
                  <>
                    <StatusBadge tone={moduleOn ? "success" : "neutral"}>{moduleOn ? t("modules.status.on") : t("modules.status.off")}</StatusBadge>
                    {toggle(m.id, moduleOn, t("modules.moduleSwitch", { name: t(m.nameKey) }), t("modules.confirmOffModule", { name: t(m.nameKey) }))}
                  </>
                )
              }
            >
              <ul className="divide-y divide-line">
                {features.map((f) => {
                  const id = featureKey(f);
                  const status: FeatureStatus = featureStatus(f, MODULES, FEATURES, overrides);
                  const required = "required" in f && f.required;
                  const requires = "requires" in f ? f.requires : [];
                  const uses = "uses" in f ? f.uses : [];
                  const dependents = dependentsOf(id, FEATURES);
                  const switchedOn = status.state === "on" || status.state === "blocked";
                  return (
                    <li key={id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-medium">{t(f.nameKey)}</h3>
                          <StatusBadge tone={FEATURE_STATE_TONE[status.state]}>{t(LABEL[status.state])}</StatusBadge>
                          {required ? <Badge>{t("modules.required")}</Badge> : null}
                        </div>
                        <p className="mt-0.5 text-sm text-ink-muted">{t(f.descriptionKey)}</p>
                        <div className="mt-1.5 flex flex-col gap-1 text-xs text-ink-muted">
                          {status.state === "blocked" ? <p className="text-warning-ink">{t("modules.blockedBy", { names: names(status.missing) })}</p> : null}
                          {deps(t("modules.deps.requires"), requires)}
                          {deps(t("modules.deps.uses"), uses)}
                          {required ? null : deps(t("modules.deps.dependents"), dependents)}
                          {required ? <p>{t("modules.requiredHint")}</p> : null}
                          {status.state === "off" && !required ? <p>{t("modules.rightsInactive")}</p> : null}
                        </div>
                      </div>
                      {required || status.state === "module-off" ? null : toggle(id, switchedOn, t("modules.featureSwitch", { name: t(f.nameKey) }), t("modules.confirmOffFeature", { name: t(f.nameKey) }))}
                    </li>
                  );
                })}
              </ul>
            </Disclosure>
          );
        })}
      </div>
    </>
  );
}
