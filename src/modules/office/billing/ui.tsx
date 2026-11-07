import { StatusBadge } from "@/components/ui/layout";
import type { Translator } from "@/i18n/translate";
import type { StatusTone } from "@/lib/status-tone";
import { PaymentBadge, paymentState } from "@/modules/office/invoices/public";
import { isInvoiceType } from "./constants";
import { isDraft, offerState, type OfferState } from "./domain";

/** Ton eines Angebotsstatus: angenommen grün, offen blau, abgelaufen gelb, abgelehnt grau. */
export const OFFER_TONE: Record<OfferState, StatusTone> = { open: "info", accepted: "success", expired: "warning", rejected: "neutral" };

type BadgeDoc = {
  source: string;
  docType: string;
  finalizedAt: Date | null;
  offerStatus: string | null;
  validUntil: Date | null;
  status: string;
  dueDate: Date | null;
  paidCents: number;
  sentAt: Date | null;
};

/**
 * Die Statusmarken eines Beleges: Entwurf, bei Angeboten offen/angenommen/abgelehnt/abgelaufen, bei Buchungsbelegen der Zahlstatus (offen, teilweise bezahlt, überfällig, bezahlt, storniert),
 * bei ausgestellten Auftragsbestätigungen „Ausgestellt“ – dazu „Versendet“, wenn der Beleg per E-Mail hinausging. Der Zustand steht als Text, nicht nur als Farbe.
 */
export function DocBadges({ doc, t, now }: { doc: BadgeDoc; t: Translator["t"]; now?: Date }) {
  const sent = doc.sentAt ? <StatusBadge tone="neutral">{t("billing.status.sent")}</StatusBadge> : null;
  if (isDraft(doc)) return <StatusBadge tone="neutral">{t("billing.status.draft")}</StatusBadge>;
  if (doc.docType === "offer") {
    const state = offerState(doc, now);
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <StatusBadge tone={OFFER_TONE[state]}>{t(`billing.status.${state === "open" ? "open" : state}`)}</StatusBadge>
        {sent}
      </span>
    );
  }
  if (isInvoiceType(doc.docType)) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <PaymentBadge state={paymentState(doc, now)} t={t} />
        {sent}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <StatusBadge tone="info">{t("billing.status.issued")}</StatusBadge>
      {sent}
    </span>
  );
}
