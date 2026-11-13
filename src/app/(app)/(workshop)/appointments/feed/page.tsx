import type { Metadata } from "next";
import { Alert, Card, TextLink } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { nowDate } from "@/lib/dates";
import { FeedCard } from "@/modules/workshop/appointments/feed-card";
import { feedStatusOf } from "@/modules/workshop/appointments/queries";
import { requirePermission } from "@/server/auth/session";
import { getPublicUrl } from "@/server/public-url";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("appointments.feedPage.title") };
}

/**
 * Kalender-Abo einrichten (F10): zeigt, was der Kalender enthält, den Stand der eigenen Abo-Adresse und lässt sie erzeugen, erneuern oder widerrufen (jeweils mit Passwortabfrage). Es gibt höchstens eine
 * Adresse je Benutzer; der Klartext erscheint nur einmal nach dem Erzeugen. Die Adresse beginnt mit der eingestellten „Adresse der Anwendung“ (nie mit einem Wert aus der Anfrage; ohne Einstellung
 * setzt der Browser die geöffnete Adresse ein).
 */
export default async function CalendarFeedPage() {
  const session = await requirePermission("appointments.view");
  const [{ t, date }, base, row] = await Promise.all([getI18n(), getPublicUrl(), feedStatusOf(session.user.id)]);
  const now = nowDate().getTime();
  const status = row
    ? {
        hint: row.hint,
        createdOn: date(row.createdAt, { dateStyle: "medium" }),
        expiresOn: row.expiresAt ? date(row.expiresAt, { dateStyle: "medium" }) : null,
        expired: row.expiresAt ? row.expiresAt.getTime() <= now : false,
        lastUsedOn: row.lastUsedAt ? date(row.lastUsedAt, { dateStyle: "medium", timeStyle: "short" }) : null,
      }
    : null;

  return (
    <>
      <PageHeader back={{ href: "/appointments", label: t("nav.appointments") }} help="workshop.appointments" title={t("appointments.feedPage.title")} description={t("appointments.feedPage.description")} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card title={t("appointments.feedPage.title")} className="min-w-0">
          <div className="flex flex-col gap-4">
            <Alert tone="warning">{t("appointments.feedPage.secretNotice")}</Alert>
            {base ? null : (
              <Alert tone="info">
                {t("appointments.feedPage.noAddress")} {session.can("settings.manage") ? <TextLink href="/settings?tab=security" className="inline! min-h-0! min-w-0!">{t("appointments.feedPage.setAddress")}</TextLink> : null}
              </Alert>
            )}
            <FeedCard status={status} base={base} />
          </div>
        </Card>
        <Card title={t("appointments.feedPage.includesTitle")} className="min-w-0">
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
            <li>{t("appointments.feedPage.includes.appointments")}</li>
            <li>{t("appointments.feedPage.includes.absences")}</li>
            <li>{t("appointments.feedPage.includes.deadlines")}</li>
            <li>{t("appointments.feedPage.includes.period")}</li>
          </ul>
          <p className="mt-4 text-sm text-ink-muted">{t("appointments.feedPage.passwordChangeNote")}</p>
        </Card>
      </div>
    </>
  );
}
