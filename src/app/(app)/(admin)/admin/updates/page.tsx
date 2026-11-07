import type { Metadata } from "next";
import { RefreshCw } from "lucide-react";
import { Alert, Badge, Card, DefinitionList, StatusBadge } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/buttons";
import { Markdown } from "@/components/ui/markdown";
import { getI18n } from "@/i18n/server";
import { compareVersions } from "@/lib/updates/semver";
import { readState } from "@/lib/updates/store";
import { requirePermission } from "@/server/auth/session";
import { checkForUpdates } from "@/modules/admin/updates/actions";
import { runningMeta, runsFromVolume, updateConfig, updaterEnabled } from "@/modules/admin/updates/config";
import { InstallForm, UpdateWatcher } from "@/modules/admin/updates/install-panel";
import { needsNewImage } from "@/modules/admin/updates/manifest";
import { checkLatestRelease } from "@/modules/admin/updates/releases";
import { FieldLabel } from "@/components/ui/form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("updates.title") };
}

export default async function UpdatesPage() {
  await requirePermission("updates.manage");
  const { t, date } = await getI18n();
  const running = runningMeta();
  const enabled = updaterEnabled();
  const state = enabled ? readState() : null;
  const check = await checkLatestRelease();
  const hasToken = !!(await updateConfig()).token;

  const release = "release" in check ? check.release : null;
  const newer = release ? compareVersions(release.version, running.version) > 0 : false;
  const imageNeeded = release ? needsNewImage(release.manifest, running) : false;

  return (
    <>
      <PageHeader help="admin.updates" title={t("updates.title")} description={t("updates.description")} />
      <div className="flex max-w-3xl flex-col gap-5">
        <Card title={t("updates.current.title")}>
          <DefinitionList
            items={[
              { label: t("updates.current.version"), value: <span className="tabular font-medium">{running.version}</span> },
              { label: t("updates.current.runtime"), value: <span className="tabular">Node {process.version.replace(/^v/, "")}</span> },
              {
                label: t("updates.current.source"),
                value: enabled ? (runsFromVolume() ? t("updates.current.volume") : t("updates.current.builtin")) : t("updates.current.dev"),
              },
              {
                label: t("updates.current.mode"),
                value: enabled ? <StatusBadge tone="success">{t("updates.current.enabled")}</StatusBadge> : <Badge>{t("updates.current.disabled")}</Badge>,
              },
            ]}
          />
          {state?.last ? (
            <div className="mt-4">
              <Alert tone={state.last.status === "ok" ? "success" : "warning"}>
                {state.last.status === "ok"
                  ? t("updates.last.ok", { version: state.last.version, date: date(state.last.at, { dateStyle: "medium", timeStyle: "short" }) })
                  : t("updates.last.rolledBack", {
                      version: state.last.version,
                      date: date(state.last.at, { dateStyle: "medium", timeStyle: "short" }),
                      reason: state.last.reason ?? "–",
                    })}
              </Alert>
            </div>
          ) : null}
        </Card>

        <Card
          title={t("updates.check.title")}
          actions={
            <form action={checkForUpdates}>
              <SubmitButton variant="secondary" size="sm">
                <RefreshCw className="size-3.5" aria-hidden /> {t("updates.check.button")}
              </SubmitButton>
            </form>
          }
        >
          {state?.pending && state.current ? (
            <UpdateWatcher target={state.current} labels={{ restarting: t("updates.install.restarting"), timeout: t("updates.install.timeout") }} />
          ) : "error" in check ? (
            <div className="flex flex-col gap-3">
              <Alert tone="danger">{t(`updates.errors.${check.error}`)}</Alert>
              {!hasToken ? <p className="text-sm text-ink-muted">{t("updates.tokenMissing")}</p> : null}
            </div>
          ) : !release || !newer ? (
            <Alert tone="success">{t("updates.check.upToDate", { version: release?.version ?? running.version })}</Alert>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold">{t("updates.check.available", { version: release.version })}</h3>
                {release.publishedAt ? <span className="text-sm text-ink-muted">{date(release.publishedAt, { dateStyle: "medium" })}</span> : null}
              </div>
              {release.notes.trim() ? (
                <div>
                  <FieldLabel>{t("updates.check.notes")}</FieldLabel>
                  <div className="max-h-72 overflow-y-auto rounded-md border border-line p-4">
                    <Markdown source={release.notes} />
                  </div>
                </div>
              ) : null}
              {imageNeeded ? (
                <Alert tone="warning">{t("updates.needsImage")}</Alert>
              ) : !enabled ? (
                <Alert tone="info">{t("updates.disabledHint")}</Alert>
              ) : (
                <>
                  <Alert tone="info">{t("updates.install.backupHint")}</Alert>
                  <InstallForm
                    version={release.version}
                    labels={{
                      button: t("updates.install.button", { version: release.version }),
                      confirm: t("updates.install.confirm", { version: release.version }),
                    }}
                  />
                </>
              )}
            </div>
          )}
          {"at" in check ? <p className="mt-4 text-xs text-ink-muted">{t("updates.check.checkedAt", { date: date(check.at, { dateStyle: "short", timeStyle: "medium" }) })}</p> : null}
        </Card>
      </div>
    </>
  );
}
