import "server-only";
import type { PrintNoteDef } from "@/modules/types";
import { intakeProtocol } from "./queries";

/**
 * Beitrag zur **Auftragskarte** (F8): der Stand des Annahmeprotokolls dieses Auftrags – nicht begonnen, offen oder abgeschlossen (mit Datum, Person und der Art der Unterschrift). Die Aufträge kennen die
 * Checklisten nicht; die Karte fragt nur die Registry. Gelesen wird über `intakeProtocol` (dieselben Rechte und Sperren wie die Detailseite der Checkliste). Das Protokoll selbst wird nicht mitgedruckt –
 * die Karte verweist darauf, das Protokoll hat in den Checklisten seinen einzigen Eigentümer.
 */
export const printNotes: PrintNoteDef[] = [
  {
    id: "checklists-intake",
    feature: "workshop.checklists",
    host: "orders/card",
    permission: "checklists.view",
    uses: ["workshop.orders"],
    order: 10,
    async lines({ entityId, session, i18n }) {
      const { t, date } = i18n;
      const label = t("checklists.print.intake");
      const protocol = await intakeProtocol(session, entityId);
      if (!protocol) return [[label, t("checklists.print.missing")]];
      if (protocol.status !== "completed") return [[label, t("checklists.print.open")]];
      const signature = protocol.signature.kind === "image" ? t("checklists.print.signed") : protocol.signature.kind === "typed" ? t("checklists.print.typed", { name: protocol.signature.name ?? "" }) : t("checklists.print.unsigned");
      const when = protocol.completedAt ? date(protocol.completedAt, { dateStyle: "medium" }) : "";
      return [[label, t("checklists.print.done", { date: when, name: protocol.completedByName ?? "–", signature })]];
    },
  },
];
