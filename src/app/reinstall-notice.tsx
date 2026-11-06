import { Alert, Card, PageHeader } from "@/components/ui/layout";

/**
 * Statt der Anwendung, wenn die Datenbank im Volume aus einer nicht verträglichen Version stammt (fremde Migrationshistorie, siehe
 * src/server/startup.ts). Fasst die Datenbank nicht an – daher zweisprachig fest im Text statt über die Übersetzungen (Sprache/Theme
 * stehen in der Datenbank).
 */
export function ReinstallNotice() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Card>
        <PageHeader title="Neuinstallation nötig · Reinstallation required" />
        <div className="grid gap-4 text-sm">
          <Alert tone="danger">
            Die Datenbank in diesem Volume stammt aus einer nicht verträglichen Version von SchrauberOS (zum Beispiel 0.1.0). Die Anwendung startet deshalb nicht und hat nichts verändert.
          </Alert>
          <p>Bitte mit einem neuen, leeren Volume starten und neu einrichten. Daten der alten Version werden nicht übernommen.</p>
          <Alert tone="danger">The database in this volume comes from an incompatible SchrauberOS version (for example 0.1.0). The application therefore does not start and has not changed anything.</Alert>
          <p>Please start with a new, empty volume and set up again. Data from the old version is not carried over.</p>
        </div>
      </Card>
    </main>
  );
}
