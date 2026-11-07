import "server-only";
import { isValidIban } from "@/lib/bank-tax";
import type { SetupCheckDef } from "@/modules/types";
import { getWorkshop } from "@/server/workshop";

const filled = (value: string | null | undefined): boolean => Boolean(value && value.trim());

/**
 * Einrichtungspunkt der Rechnungserstellung: Das Werkstattprofil trägt, was auf jeder Rechnung steht – Anschrift, Steuernummer oder USt-IdNr., gültige IBAN (Überweisung, Girocode) und beide Kontaktwege
 * (Telefon **und** E-Mail: Pflicht des Kontakts in der XRechnung). Der Punkt hakt sich von selbst ab und erscheint nur mit aktiver Funktion; die Prüfliste am Beleg zeigt dieselben Lücken je Rechnung.
 */
export const setupChecks: SetupCheckDef[] = [
  {
    id: "billingProfile",
    feature: "office.billing",
    permission: "settings.manage",
    labelKey: "billing.setup.label",
    hintKey: "billing.setup.hint",
    href: "/settings",
    order: 14,
    recommended: true,
    done: async () => {
      const w = await getWorkshop();
      return filled(w.street) && filled(w.zip) && filled(w.city) && (filled(w.taxNumber) || filled(w.vatId)) && filled(w.iban) && isValidIban(w.iban ?? "") && filled(w.phone) && filled(w.email);
    },
  },
];
