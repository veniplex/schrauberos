import type { ReactNode } from "react";
import { LinkButton } from "@/components/ui/buttons";
import { Plate, StatusBadge } from "@/components/ui/layout";
import { UrlModal } from "@/components/ui/modal";
import { getI18n } from "@/i18n/server";
import { isHexColor } from "@/lib/color";
import { customerDisplayName } from "@/modules/workshop/customers/public";
import { formatTireSize } from "@/modules/workshop/tires/public";
import { db } from "@/server/db";
import { calendarHref, type CalendarView } from "./calendar";
import { appointmentInclude } from "./queries";
import { STATUS_TONE } from "./status-tone";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  );
}

/**
 * Leseansicht eines Termins (`?show=<id>`) für alle, die den Kalender sehen – vor allem für Personen **ohne** das Recht „Termine bearbeiten“, die sonst nur eine Kachel ohne
 * Inhalt sähen (und auf dem Handy ohne Tooltip). Zeigt, was der Kalender weiß: Zeit, Status, Terminart, Fahrzeug, Kunde (nur der Anzeigename – Kontaktdaten gibt es nur in der
 * Kundenfunktion mit eigenem Recht), Arbeitsplatz, Zuständigen, Reifensatz und die Notizen im Volltext. Mit dem Recht zum Bearbeiten führt „Bearbeiten“ ins Formular.
 * Gibt es den Termin nicht mehr, erscheint nichts (die Seite bleibt benutzbar).
 */
export async function AppointmentDetail({ id, view, date, canEdit }: { id: string; view: CalendarView; date: Date; canEdit: boolean }) {
  const [i18n, a] = await Promise.all([getI18n(), db.appointment.findUnique({ where: { id }, include: appointmentInclude })]);
  if (!a) return null;
  const { t, td } = i18n;
  const customer = a.vehicle ? customerDisplayName(a.vehicle.customer) : a.customer ? customerDisplayName(a.customer) : "";
  const day = i18n.date(a.startsAt, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const time = `${i18n.date(a.startsAt, { timeStyle: "short" })}–${i18n.date(a.endsAt, { timeStyle: "short" })}`;
  const tireSet = a.tireSet ? [a.tireSet.vehicle.plate, td(`enums.season.${a.tireSet.season}`, a.tireSet.season), a.tireSet.brand, formatTireSize(a.tireSet)].filter((p) => p && p !== "–").join(" · ") : "";
  const closeHref = calendarHref(view, date);

  return (
    <UrlModal title={a.title} closeHref={closeHref}>
      <dl className="flex flex-col gap-3">
        <Row label={t("appointments.detail.when")}>
          <span className="font-medium">{day}</span>, <span className="tabular">{time}</span>
        </Row>
        <Row label={t("common.status")}>
          <StatusBadge tone={STATUS_TONE[a.status as keyof typeof STATUS_TONE] ?? "neutral"}>{td(`enums.appointmentStatus.${a.status}`, a.status)}</StatusBadge>
        </Row>
        {a.type ? (
          <Row label={t("appointments.fields.type")}>
            <span className="inline-flex items-center gap-2">
              <span aria-hidden className="size-3 rounded-full border border-line" style={{ backgroundColor: isHexColor(a.type.color) ? a.type.color : "var(--accent)" }} />
              {a.type.name}
            </span>
          </Row>
        ) : null}
        {a.vehicle ? (
          <Row label={t("appointments.detail.vehicle")}>
            <Plate>{a.vehicle.plate}</Plate>
          </Row>
        ) : null}
        {customer ? <Row label={t("appointments.detail.customer")}>{customer}</Row> : null}
        {a.bay ? <Row label={t("appointments.fields.bay")}>{a.bay.name}</Row> : null}
        {a.assignee ? <Row label={t("appointments.fields.assignee")}>{a.assignee.name}</Row> : null}
        {tireSet ? <Row label={t("appointments.detail.tireSet")}>{tireSet}</Row> : null}
        <Row label={t("common.notes")}>{a.notes ? <span className="whitespace-pre-line">{a.notes}</span> : <span className="text-ink-muted">{t("appointments.detail.noNotes")}</span>}</Row>
      </dl>
      <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
        {!canEdit ? <p className="mr-auto text-xs text-ink-muted">{t("appointments.detail.editHint")}</p> : null}
        <LinkButton href={closeHref}>{t("common.close")}</LinkButton>
        {canEdit ? (
          <LinkButton variant="primary" href={calendarHref(view, date, { edit: a.id })}>
            {t("common.edit")}
          </LinkButton>
        ) : null}
      </div>
    </UrlModal>
  );
}
