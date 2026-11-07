import { StatusBadge } from "@/components/ui/layout";
import type { PaymentState } from "@/modules/office/invoices/domain";
import { PAYMENT_TONE } from "@/modules/office/invoices/status-tone";
import type { Translator } from "@/i18n/translate";

export function PaymentBadge({ state, t }: { state: PaymentState; t: Translator["t"] }) {
  return <StatusBadge tone={PAYMENT_TONE[state]}>{t(`invoices.payment.${state}`)}</StatusBadge>;
}
