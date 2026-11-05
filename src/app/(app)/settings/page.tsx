import type { Metadata } from "next";
import clsx from "clsx";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { Card, PageHeader } from "@/components/ui/layout";
import { ConfirmSubmitButton, SubmitButton } from "@/components/ui/buttons";
import { Field, Input, Select } from "@/components/ui/form";
import { getI18n } from "@/i18n/server";
import { APPOINTMENT_KINDS } from "@/lib/domain/constants";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { getWorkshop } from "@/server/workshop";
import { WorkshopForm } from "@/modules/core/forms";
import { deleteAppointmentType, deleteBay, saveAppointmentType, saveBay } from "@/modules/core/settings-actions";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.settings") };
}

const TABS = ["workshop", "bays", "types"] as const;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requirePermission("settings.manage");
  const [{ t, td }, sp] = await Promise.all([getI18n(), searchParams]);
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as (typeof TABS)[number]) : "workshop";

  return (
    <>
      <PageHeader title={t("settings.title")} description={t("settings.description")} />
      <nav aria-label={t("settings.title")} className="mb-5 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line">
        {TABS.map((id) => (
          <Link
            key={id}
            href={`/settings?tab=${id}`}
            aria-current={tab === id ? "page" : undefined}
            className={clsx(
              "-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium",
              tab === id ? "border-accent text-accent-text" : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            {t(`settings.tabs.${id}`)}
          </Link>
        ))}
      </nav>

      {tab === "workshop" ? <WorkshopTab /> : null}

      {tab === "bays" ? <BaysTab /> : null}

      {tab === "types" ? (
        <TypesTab
          labels={{
            name: t("settings.types.name"),
            color: t("settings.types.color"),
            minutes: t("settings.types.minutes"),
            kind: t("settings.types.kind"),
            active: t("settings.active"),
            add: t("common.add"),
            save: t("common.save"),
            remove: t("common.delete"),
            confirm: t("settings.types.confirmDelete"),
            kinds: Object.fromEntries(APPOINTMENT_KINDS.map((k) => [k, td(`enums.appointmentKind.${k}`, k)])),
            title: t("settings.types.title"),
            hint: t("settings.types.hint"),
            newTitle: t("settings.types.new"),
          }}
        />
      ) : null}
    </>
  );
}

async function WorkshopTab() {
  const w = await getWorkshop();
  return (
    <WorkshopForm
      initial={{
        name: w.name,
        tagline: w.tagline ?? "",
        street: w.street ?? "",
        zip: w.zip ?? "",
        city: w.city ?? "",
        phone: w.phone ?? "",
        email: w.email ?? "",
        website: w.website ?? "",
        accentColor: w.accentColor,
        logoDataUrl: w.logoDataUrl,
        hours: w.hours,
        dayStartHour: w.dayStartHour,
        dayEndHour: w.dayEndHour,
        slotMinutes: w.slotMinutes,
        treadWarnMm: w.treadWarnMm,
        treadReplaceMm: w.treadReplaceMm,
        tireAgeWarnYears: w.tireAgeWarnYears,
        tireAgeReplaceYears: w.tireAgeReplaceYears,
      }}
    />
  );
}

async function BaysTab() {
  const { t } = await getI18n();
  const bays = await db.bay.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <Card title={t("settings.bays.title")} padded={false}>
        <p className="px-5 pt-3 text-sm text-ink-muted">{t("settings.bays.hint")}</p>
        <ul className="divide-y divide-line">
          {bays.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <form action={saveBay} className="flex flex-1 flex-wrap items-center gap-3">
                <input type="hidden" name="id" value={b.id} />
                <Input name="name" defaultValue={b.name} aria-label={t("settings.bays.name")} className="min-w-40 flex-1" required maxLength={60} />
                <Input name="sortOrder" type="number" min={0} defaultValue={b.sortOrder} aria-label={t("settings.sortOrder")} className="w-20" />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="active" defaultChecked={b.active} className="size-4 accent-[var(--accent)]" /> {t("settings.active")}
                </label>
                <SubmitButton variant="secondary" size="sm">{t("common.save")}</SubmitButton>
              </form>
              <form action={deleteBay}>
                <input type="hidden" name="id" value={b.id} />
                <ConfirmSubmitButton message={t("settings.bays.confirmDelete")} aria-label={t("common.delete")}>
                  <Trash2 className="size-3.5" aria-hidden />
                </ConfirmSubmitButton>
              </form>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={t("settings.bays.new")}>
        <form action={saveBay} className="flex flex-wrap items-end gap-3">
          <Field label={t("settings.bays.name")} htmlFor="new-bay" className="min-w-48 flex-1">
            <Input id="new-bay" name="name" required maxLength={60} placeholder="Hebebühne 3" />
          </Field>
          <SubmitButton>{t("common.add")}</SubmitButton>
        </form>
      </Card>
    </div>
  );
}

type TypesLabels = {
  name: string; color: string; minutes: string; kind: string; active: string; add: string; save: string; remove: string;
  confirm: string; kinds: Record<string, string>; title: string; hint: string; newTitle: string;
};

async function TypesTab({ labels }: { labels: TypesLabels }) {
  const types = await db.appointmentType.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  const fields = (v?: (typeof types)[number]) => (
    <>
      {v ? <input type="hidden" name="id" value={v.id} /> : null}
      <Input name="name" defaultValue={v?.name} aria-label={labels.name} placeholder={labels.name} className="min-w-40 flex-1" required maxLength={60} />
      <input type="color" name="color" defaultValue={v?.color ?? "#2459c9"} aria-label={labels.color} className="size-9 cursor-pointer rounded-md border border-line-strong bg-surface p-0.5" />
      <Input name="defaultMinutes" type="number" min={5} max={720} step={5} defaultValue={v?.defaultMinutes ?? 60} aria-label={labels.minutes} className="w-24" required />
      <Select name="kind" defaultValue={v?.kind ?? "general"} aria-label={labels.kind} className="w-44">
        {APPOINTMENT_KINDS.map((k) => (
          <option key={k} value={k}>
            {labels.kinds[k]}
          </option>
        ))}
      </Select>
    </>
  );
  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <Card title={labels.title} padded={false}>
        <p className="px-5 pt-3 text-sm text-ink-muted">{labels.hint}</p>
        <ul className="divide-y divide-line">
          {types.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <form action={saveAppointmentType} className="flex flex-1 flex-wrap items-center gap-3">
                {fields(v)}
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="active" defaultChecked={v.active} className="size-4 accent-[var(--accent)]" /> {labels.active}
                </label>
                <SubmitButton variant="secondary" size="sm">{labels.save}</SubmitButton>
              </form>
              <form action={deleteAppointmentType}>
                <input type="hidden" name="id" value={v.id} />
                <ConfirmSubmitButton message={labels.confirm} aria-label={labels.remove}>
                  <Trash2 className="size-3.5" aria-hidden />
                </ConfirmSubmitButton>
              </form>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={labels.newTitle}>
        <form action={saveAppointmentType} className="flex flex-wrap items-center gap-3">
          {fields()}
          <SubmitButton>{labels.add}</SubmitButton>
        </form>
      </Card>
    </div>
  );
}
