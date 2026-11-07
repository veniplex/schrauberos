import type { Metadata } from "next";
import { RefreshCw } from "lucide-react";
import { Alert, Badge, Card, DefinitionList, StatusBadge } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/buttons";
import { Markdown } from "@/components/ui/markdown";
import { getI18n } from "@/i18n/server";
import type { MessageKey } from "@/i18n/translate";
import { splitBytes } from "@/lib/bytes";
import { endorsementWarning } from "@/lib/updates/expiry";
import { INCONCLUSIVE_REASONS, integrityCodeOf, parseVerifyOk } from "@/lib/updates/markers";
import { compareVersions } from "@/lib/updates/semver";
import { countsAsAttempt } from "@/lib/updates/state";
import { readSmallFile, readState, verifyOkFile } from "@/lib/updates/store";
import { requirePermission } from "@/server/auth/session";
import { checkForUpdates } from "@/modules/admin/updates/actions";
import { runningMeta, runsFromVolume, updateConfig, updaterEnabled } from "@/modules/admin/updates/config";
import { InstallForm, UpdateWatcher } from "@/modules/admin/updates/install-panel";
import { needsNewImage } from "@/modules/admin/updates/manifest";
import { checkLatestRelease, fetchReleaseNotes } from "@/modules/admin/updates/releases";
import { FieldLabel } from "@/components/ui/form";


export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("updates.title") };
}

export default async function UpdatesPage() {
  await requirePermission("updates.manage");
  const { t, date, number } = await getI18n();
  const running = runningMeta();
  const enabled = updaterEnabled();
  const state = enabled ? readState() : null;
  const [check, installedNotes] = await Promise.all([checkLatestRelease(), fetchReleaseNotes(running.version)]);
  const hasToken = !!(await updateConfig()).token;

  const release = "release" in check ? check.release : null;
  const newer = release ? compareVersions(release.version, running.version) > 0 : false;
  const imageNeeded = release ? needsNewImage(release.manifest, running) : false;

  // Integrität (Starter-Vertrauensanker): letzter Befund, unklare Prüfung, letzte erfolgreiche Prüfung, Beglaubigung des Release-Schlüssels
  const integrityCode = state?.last?.status === "rolled-back" ? integrityCodeOf(state.last.reason) : null;
  const unclear = state?.inconclusive ?? null;
  const verified = enabled ? parseVerifyOk(readSmallFile(verifyOkFile()) ?? "") : null;
  const expiringDays = release ? endorsementWarning(release.endorsedUntil) : null;
  const repair = !!release && !!state && state.failed.includes(release.version) && integrityCode !== null;
  const sizeLabel = (bytes: number) => {
    const { value, unit } = splitBytes(bytes);
    return `${number(value, { maximumFractionDigits: unit === "B" || value >= 100 ? 0 : 1 })} ${unit}`;
  };

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
          {verified || enabled ? (
            <p className="mt-4 text-sm text-ink-muted">
              <span className="font-medium">{t("updates.verified.title")}: </span>
              {verified
                ? t("updates.verified.text", {
                    version: verified.version,
                    files: number(verified.files),
                    size: sizeLabel(verified.bytes),
                    seconds: number(verified.ms / 1000, { maximumFractionDigits: 1 }),
                    date: date(verified.at, { dateStyle: "medium", timeStyle: "short" }),
                  })
                : t("updates.verified.none")}
            </p>
          ) : null}
          {integrityCode !== null && state?.last ? (
            <div className="mt-4 flex flex-col gap-2">
              <Alert tone="danger">
                {t("updates.integrity.rolledBack", {
                  version: state.last.version,
                  date: date(state.last.at, { dateStyle: "medium", timeStyle: "short" }),
                  reason: t(`updates.integrity.codes.c${integrityCode}` as MessageKey),
                  detail: state.last.detail ? t("updates.integrity.detail", { path: state.last.detail }) : "",
                })}
              </Alert>
              <p className="text-sm text-ink-muted">{t("updates.integrity.hint")}</p>
            </div>
          ) : null}
          {unclear ? (
            <div className="mt-4">
              <Alert tone="warning">
                {unclear.reason === "quiesce"
                  ? t("updates.integrity.notStarted", { version: unclear.version })
                  : t(countsAsAttempt(unclear.reason) ? "updates.integrity.unclear" : "updates.integrity.unclearUncounted", {
                      version: unclear.version,
                      count: unclear.count,
                      reason: t(`updates.integrity.unclearReasons.${(INCONCLUSIVE_REASONS as readonly string[]).includes(unclear.reason) ? unclear.reason : "other"}` as MessageKey),
                    })}
              </Alert>
            </div>
          ) : null}
          {state?.last && integrityCode === null ? (
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
                  {repair ? <Alert tone="warning">{t("updates.repair.hint", { version: release.version })}</Alert> : null}
                  {expiringDays !== null ? (
                    <Alert tone="warning">{t("updates.endorsement.expiring", { date: date(release.endorsedUntil ?? "", { dateStyle: "medium" }), days: Math.max(0, expiringDays) })}</Alert>
                  ) : null}
                  <InstallForm
                    version={release.version}
                    labels={{
                      button: repair ? t("updates.repair.button", { version: release.version }) : t("updates.install.button", { version: release.version }),
                      confirm: repair ? t("updates.repair.confirm", { version: release.version }) : t("updates.install.confirm", { version: release.version }),
                    }}
                  />
                </>
              )}
            </div>
          )}
          {"at" in check ? <p className="mt-4 text-xs text-ink-muted">{t("updates.check.checkedAt", { date: date(check.at, { dateStyle: "short", timeStyle: "medium" }) })}</p> : null}
        </Card>

        <Card title={t("updates.changelog.title")}>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold">{t("updates.changelog.installed", { version: running.version })}</h3>
              {installedNotes?.publishedAt ? <span className="text-sm text-ink-muted">{t("updates.changelog.published", { date: date(installedNotes.publishedAt, { dateStyle: "medium" }) })}</span> : null}
            </div>
            {installedNotes ? (
              <>
                <div className="max-h-96 overflow-y-auto rounded-md border border-line p-4">
                  <Markdown source={installedNotes.notes} />
                </div>
                {installedNotes.fromCopy ? <p className="text-xs text-ink-muted">{t("updates.changelog.fromCopy")}</p> : null}
              </>
            ) : (
              <p className="text-sm text-ink-muted">{running.version.includes("-") ? t("updates.changelog.dev") : t("updates.changelog.none")}</p>
            )}
            {newer ? <p className="text-xs text-ink-muted">{t("updates.changelog.newer")}</p> : null}
          </div>
        </Card>
      </div>
    </>
  );
}
