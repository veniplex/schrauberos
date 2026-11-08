import type { StatusTone } from "@/lib/status-tone";
import type { VaultState } from "./vault-constants";

/** Zustand eines Tresor-Eintrags: hinterlegt = in Ordnung, noch keine Zugangsdaten = neutral, neu eingeben nötig = Aufmerksamkeit */
export const VAULT_STATE_TONE: Record<VaultState, StatusTone> = { sealed: "success", empty: "neutral", unreadable: "warning" };
