import type { DeliveryStatus } from "@/lib/webhooks/schedule";
import type { StatusTone } from "@/lib/status-tone";

/** Zustand einer Zustellung → Ton der `StatusBadge` (wartet = Information, zurückgestellt und unterdrückt = grau, zugestellt = grün, aufgegeben = rot, Ziel meldet „gone“ = gelb). */
export const DELIVERY_STATUS_TONE: Record<DeliveryStatus, StatusTone> = { pending: "info", held: "neutral", sent: "success", failed: "danger", gone: "warning", suppressed: "neutral" };

/** Zustand eines Tokens (nicht gespeichert, aus Ablauf und Widerruf berechnet) → Ton. */
export type TokenStatus = "active" | "expired" | "revoked";
export const TOKEN_STATUS_TONE: Record<TokenStatus, StatusTone> = { active: "success", expired: "danger", revoked: "neutral" };

/** `now` kommt von außen (Komponenten rufen die Uhr nicht selbst; Tests geben sie vor). */
export const tokenStatusOf = (token: { revokedAt: Date | null; expiresAt: Date }, now = Date.now()): TokenStatus => (token.revokedAt ? "revoked" : token.expiresAt.getTime() <= now ? "expired" : "active");
