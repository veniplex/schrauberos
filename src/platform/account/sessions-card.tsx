import type { ReactNode } from "react";
import { Badge, Card } from "@/components/ui/layout";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { getI18n } from "@/i18n/server";
import { describeAgent } from "@/lib/user-agent";
import type { DeviceRow } from "@/server/auth/devices";
import type { SessionRow } from "@/server/auth/session";
import { logoutEverywhere, revokeDevice, revokeSession } from "./security-actions";

type Row = { id: string; userAgent: string | null; ipHint: string | null; createdAt: Date; lastUsedAt: Date; current: boolean };
type Labelled = Row & { label: string };

/** Browser und System als Text („Firefox auf Linux“); ohne Angaben „Unbekanntes Gerät“. */
async function agentLabel(userAgent: string | null): Promise<string> {
  const { t } = await getI18n();
  const { browser, os } = describeAgent(userAgent);
  if (!browser && !os) return t("security.unknownAgent");
  return browser && os ? t("security.agent", { browser, os }) : (browser ?? os)!;
}

/** Gemeinsame Spalten der Listen „Meine Sitzungen“ und „Bekannte Geräte“: Browser/System, zuletzt aktiv, seit wann, grobe Adresse – und der Knopf zum Beenden. */
async function columns(options: { revoke: (row: Labelled) => ReactNode; currentLabel: string }): Promise<Array<DataColumn<Labelled>>> {
  const { t, date } = await getI18n();
  return [
    {
      id: "agent",
      header: t("security.columns.device"),
      priority: "primary",
      cell: (row) => (
        <span className="flex flex-wrap items-center gap-2">
          <span>{row.label}</span>
          {row.current ? <Badge tone="accent">{options.currentLabel}</Badge> : null}
        </span>
      ),
    },
    { id: "last", header: t("security.columns.lastUsed"), cell: (row) => date(row.lastUsedAt, { dateStyle: "medium", timeStyle: "short" }) },
    { id: "since", header: t("security.columns.since"), priority: "low", cell: (row) => date(row.createdAt, { dateStyle: "medium" }) },
    { id: "ip", header: t("security.columns.network"), priority: "low", cell: (row) => row.ipHint ?? "–" },
    { id: "actions", header: t("common.actions"), hideHeader: true, align: "end", cell: (row) => options.revoke(row) },
  ];
}

async function labelled(rows: Row[]): Promise<Labelled[]> {
  return Promise.all(rows.map(async (row) => ({ ...row, label: await agentLabel(row.userAgent) })));
}

/** „Meine Sitzungen“: alle angemeldeten Browser des Kontos, die aktuelle markiert; einzelne beenden oder überall abmelden. */
export async function SessionsCard({ sessions }: { sessions: SessionRow[] }) {
  const { t } = await getI18n();
  const rows = await labelled(sessions);
  const table = await columns({
    currentLabel: t("security.sessions.current"),
    revoke: (row) =>
      row.current ? null : (
        <form action={revokeSession}>
          <input type="hidden" name="id" value={row.id} />
          <ConfirmSubmitButton message={t("security.sessions.confirmRevoke")} label={t("security.sessions.revoke")} target={row.label}>
            {t("security.sessions.revoke")}
          </ConfirmSubmitButton>
        </form>
      ),
  });
  return (
    <Card title={t("security.sessions.title")} className="print:hidden lg:col-span-2">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-muted">{t("security.sessions.intro")}</p>
        <DataTable caption={t("security.sessions.title")} columns={table} rows={rows} rowKey={(row) => row.id} minWidth="36rem" />
        <form action={logoutEverywhere} className="flex flex-col gap-2">
          <p className="text-sm text-ink-muted">{t("security.sessions.everywhereHint")}</p>
          <div>
            <ConfirmSubmitButton message={t("security.sessions.confirmEverywhere")} variant="danger" size="md">
              {t("security.sessions.everywhere")}
            </ConfirmSubmitButton>
          </div>
        </form>
      </div>
    </Card>
  );
}

/** „Bekannte Geräte“: Browser, die ihr Konto ohne Konto-Wartezeit anmelden dürfen – jedes lässt sich vergessen. */
export async function DevicesCard({ devices }: { devices: DeviceRow[] }) {
  const { t } = await getI18n();
  const rows = await labelled(devices);
  const table = await columns({
    currentLabel: t("security.devices.current"),
    revoke: (row) => (
      <form action={revokeDevice}>
        <input type="hidden" name="id" value={row.id} />
        <ConfirmSubmitButton message={t("security.devices.confirmRevoke")} label={t("security.devices.revoke")} target={row.label}>
          {t("security.devices.revoke")}
        </ConfirmSubmitButton>
      </form>
    ),
  });
  return (
    <Card title={t("security.devices.title")} className="print:hidden lg:col-span-2">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-muted">{t("security.devices.intro")}</p>
        {rows.length === 0 ? (
          <p className="text-sm">{t("security.devices.none")}</p>
        ) : (
          <DataTable caption={t("security.devices.title")} columns={table} rows={rows} rowKey={(row) => row.id} minWidth="36rem" />
        )}
      </div>
    </Card>
  );
}
