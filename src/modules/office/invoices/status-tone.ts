import type { StatusTone } from "@/lib/status-tone";
import type { PaymentState } from "./domain";

export const PAYMENT_TONE: Record<PaymentState, StatusTone> = { open: "info", partial: "info", overdue: "danger", paid: "success", cancelled: "neutral" };
