import "server-only";
import { CSP_MODE_KEY, parseCspMode, setCspModeInProcess } from "@/lib/csp-mode";
import { getSetting } from "@/server/settings";

/** Liest den gespeicherten Zustand der Richtlinie und übernimmt ihn im Prozess (beim Start; der Proxy liest nur den Prozesszustand). */
export async function loadCspMode(): Promise<void> {
  setCspModeInProcess(parseCspMode(await getSetting(CSP_MODE_KEY)));
}
