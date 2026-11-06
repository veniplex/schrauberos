"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/buttons";
import { Alert } from "@/components/ui/layout";

/**
 * Zeigt eine Flash-Meldung (siehe `FlashNotice`) und räumt danach das Cookie weg, damit sie nur einmal erscheint. Erfolg blendet sich nach
 * einigen Sekunden aus, Fehler bleiben stehen, bis man sie schließt. Minimaler Meldungsbereich – der Toast (P2a-2) löst ihn ab. Die Ansage für Screenreader
 * übernimmt der Container in `FlashNotice` (immer im DOM, `aria-live`), deshalb hat das Hinweisfeld hier keine eigene Rolle (`live={false}`).
 */
export function FlashMessage({ id, cookieName, tone, text, closeLabel }: { id: string; cookieName: string; tone: "success" | "error"; text: string; closeLabel: string }) {
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    // Einmalige Meldung: Cookie sofort löschen (ein `__Host-`-Cookie nur mit Secure und Pfad „/“)
    document.cookie = `${cookieName}=; Max-Age=0; Path=/${cookieName.startsWith("__Host-") ? "; Secure" : ""}`;
    if (tone !== "success") return;
    const timer = setTimeout(() => setDismissed(id), 8000);
    return () => clearTimeout(timer);
  }, [id, cookieName, tone]);

  if (dismissed === id) return null;
  return (
    <div className="no-print mb-5" data-flash={tone}>
      <Alert tone={tone === "error" ? "danger" : "success"} live={false}>
        <div className="flex items-start justify-between gap-3">
          <span>{text}</span>
          <Button variant="ghost" size="icon-sm" aria-label={closeLabel} onClick={() => setDismissed(id)}>
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      </Alert>
    </div>
  );
}
