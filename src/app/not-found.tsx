import { AppShell } from "@/app/app-shell";
import { NotFoundContent } from "@/app/not-found-content";
import { getSession } from "@/server/auth/session";

// Unbekannte Adresse (außerhalb des Anwendungsrahmens): Wer angemeldet ist, sieht trotzdem die Navigation.
export default async function RootNotFound() {
  const session = await getSession();
  if (session) {
    return (
      <AppShell session={session}>
        <NotFoundContent />
      </AppShell>
    );
  }
  return <NotFoundContent fullscreen withHelp={false} />;
}
