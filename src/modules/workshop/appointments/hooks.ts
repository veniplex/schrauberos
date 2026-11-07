import type { OperationHookDef } from "@/server/operations/hooks";

/** Anonymisierung eines Kunden (`customers.anonymize`, P4b-5): Seine Termine verlieren den Kundenbezug, die Notizen (Freitext) entfallen und der Titel wird neutral. Zeit, Art, Arbeitsplatz und Fahrzeug bleiben. */
export const hooks: OperationHookDef[] = [
  {
    operation: "customers.anonymize",
    feature: "workshop.appointments",
    run: async ({ tx, input }) => {
      const { id } = input as { id: string };
      await tx.appointment.updateMany({ where: { customerId: id }, data: { customerId: null, notes: null, title: "(anonymisiert)" } });
    },
  },
];
