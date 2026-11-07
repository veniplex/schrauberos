import type { MailStatus } from "@/lib/mail";
import type { StatusTone } from "@/lib/status-tone";

/** Zustand einer Nachricht im Sendeprotokoll → Ton der `StatusBadge` (wartet = Information, gesendet = grün, aufgegeben = rot). */
export const MAIL_STATUS_TONE: Record<MailStatus, StatusTone> = { queued: "info", sent: "success", failed: "danger" };
