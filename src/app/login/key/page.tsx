import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Wrench } from "lucide-react";
import { getI18n } from "@/i18n/server";
import { db } from "@/server/db";
import { secretKeyIssue } from "@/server/secret-key-issue";
import { Alert, Card, TextLink } from "@/components/ui/layout";
import { KeyRecoveryForm } from "@/platform/account/key-recovery-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("backup.keyIssue.publicTitle") };
}

/**
 * Schlüssel wiederherstellen (öffentlich erreichbar, wie die Anmeldung): Fehlt `secret.key` oder gehört es nicht zur Datenbank, kommen Konten mit zweitem Faktor nicht
 * hinein. Mit dem Wiederherstellungsschlüssel wird die Datei aus der Hülle in der Datenbank rekonstruiert. Gibt es keine Störung, steht hier nur ein Hinweis.
 */
export default async function KeyPage() {
  if ((await db.user.count()) === 0) redirect("/setup");
  const [{ t }, issue] = await Promise.all([getI18n(), secretKeyIssue()]);
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="grid size-12 place-items-center rounded-lg bg-accent text-accent-ink">
            <Wrench className="size-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold">{t("backup.keyIssue.publicTitle")}</h1>
            <p className="text-sm text-ink-muted">{t("backup.keyIssue.publicIntro")}</p>
          </div>
        </div>
        <Card as="div">
          {issue?.recoverable ? (
            <KeyRecoveryForm onDoneHref="/login" />
          ) : (
            <Alert tone="info">{issue ? t("backup.keyIssue.notRecoverable") : t("backup.keyIssue.notNeeded")}</Alert>
          )}
          <p className="mt-4 text-center text-sm">
            <TextLink href="/login">{t("backup.keyIssue.backToLogin")}</TextLink>
          </p>
        </Card>
      </div>
    </main>
  );
}
