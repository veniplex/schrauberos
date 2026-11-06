"use client";

import "./globals.css";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/buttons";
import { StatusPage } from "@/components/ui/status-page";

// Ersetzt das Root-Layout, wenn dieses selbst scheitert (Datenbank nicht erreichbar …). Sprache und Design stehen in der
// Datenbank und sind hier nicht verfügbar: Text deshalb fest zweisprachig, Hell/Dunkel folgt dem Gerät (color-scheme in tokens.css).
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="de">
      <body>
        <StatusPage
          icon={TriangleAlert}
          tone="danger"
          fullscreen
          title="Das hat nicht geklappt · That did not work"
          actions={
            <Button variant="primary" onClick={() => retry()}>
              Erneut versuchen · Try again
            </Button>
          }
        >
          <p>Die Anwendung ist gerade nicht erreichbar. Bitte noch einmal versuchen – bleibt es dabei, bitte die Administration informieren.</p>
          <p className="mt-2">The application is not available right now. Please try again – if it keeps happening, please tell your administrator.</p>
        </StatusPage>
      </body>
    </html>
  );
}
