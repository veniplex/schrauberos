"use client";

import { useEffect } from "react";
import { useToast } from "@/components/ui/toast";

/**
 * Bringt eine Flash-Meldung (siehe `FlashNotice`) in den Toast und räumt danach das Cookie weg, damit sie nur einmal erscheint. Die Anzeige selbst (Dauer, Schließen,
 * Live-Regionen) gehört dem Toast (`components/ui/toast.tsx`); diese Komponente zeichnet nichts.
 */
export function FlashMessage({ id, cookieName, tone, text }: { id: string; cookieName: string; tone: "success" | "error"; text: string }) {
  const toast = useToast();
  useEffect(() => {
    // Einmalige Meldung: Cookie sofort löschen (ein `__Host-`-Cookie nur mit Secure und Pfad „/“)
    document.cookie = `${cookieName}=; Max-Age=0; Path=/${cookieName.startsWith("__Host-") ? "; Secure" : ""}`;
    toast.show({ id: `flash:${id}`, tone, text });
  }, [id, cookieName, tone, text, toast]);
  return null;
}
