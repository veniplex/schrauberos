import type { OperationHookDef } from "@/server/operations/hooks";

/**
 * Anonymisierung eines Kunden (`customers.anonymize`, P4b-5): Die Notizen (Freitext) der Reifensätze und Reifen seiner Fahrzeuge entfallen. Läuft **vor** dem Hook der Fahrzeuge
 * (`operation-hooks.ts`), denn danach hat das Fahrzeug den Halter nicht mehr.
 */
export const hooks: OperationHookDef[] = [
  {
    operation: "customers.anonymize",
    feature: "workshop.tires",
    run: async ({ tx, input }) => {
      const { id } = input as { id: string };
      await tx.tire.updateMany({ where: { tireSet: { vehicle: { customerId: id } } }, data: { notes: null } });
      await tx.tireSet.updateMany({ where: { vehicle: { customerId: id } }, data: { notes: null } });
    },
  },
];
