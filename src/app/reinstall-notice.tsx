import { Alert, Card } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { REINSTALL_TEXT } from "@/lib/reinstall-text";

/**
 * Statt der Anwendung, wenn die Datenbank im Volume aus einer nicht verträglichen Version stammt (fremde Migrationshistorie, siehe
 * src/server/startup.ts). Fasst die Datenbank nicht an – daher zweisprachig fest im Text statt über die Übersetzungen (Sprache/Theme
 * stehen in der Datenbank).
 */
export function ReinstallNotice() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10" data-status="reinstall">
      <Card>
        <PageHeader title={REINSTALL_TEXT.title} />
        <div className="grid gap-4 text-sm">
          <Alert tone="danger">{REINSTALL_TEXT.de[0]}</Alert>
          <p>{REINSTALL_TEXT.de[1]}</p>
          <Alert tone="danger">{REINSTALL_TEXT.en[0]}</Alert>
          <p>{REINSTALL_TEXT.en[1]}</p>
        </div>
      </Card>
    </main>
  );
}
