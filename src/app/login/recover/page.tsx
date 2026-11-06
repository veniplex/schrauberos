import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Wrench } from "lucide-react";
import { getI18n } from "@/i18n/server";
import { db } from "@/server/db";
import { Card } from "@/components/ui/layout";
import { RecoverForm } from "./recover-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("recovery.recover.title") };
}

/** Notzugang einlösen (öffentlich erreichbar, wie die Anmeldung): Wiederherstellungs-Code + neues Passwort. */
export default async function RecoverPage() {
  if ((await db.user.count()) === 0) redirect("/setup");
  const { t } = await getI18n();
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center print:hidden">
          <span className="grid size-12 place-items-center rounded-lg bg-accent text-accent-ink">
            <Wrench className="size-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold">{t("recovery.recover.title")}</h1>
            <p className="text-sm text-ink-muted">{t("recovery.recover.intro")}</p>
          </div>
        </div>
        <Card as="div">
          <RecoverForm />
        </Card>
      </div>
    </main>
  );
}
