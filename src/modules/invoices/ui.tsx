import { Badge } from "@/components/ui/layout";
import type { PaymentState } from "@/lib/domain/invoices";
import type { Translator } from "@/i18n/translate";

const TONE = { open: "info", overdue: "danger", paid: "success", cancelled: "neutral" } as const;

export function PaymentBadge({ state, t }: { state: PaymentState; t: Translator["t"] }) {
  return <Badge tone={TONE[state]}>{t(`invoices.payment.${state}`)}</Badge>;
}
