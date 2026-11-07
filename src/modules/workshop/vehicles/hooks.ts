import type { OperationHookDef } from "@/server/operations/hooks";

/**
 * Anonymisierung eines Kunden (`customers.anonymize`, P4b-5), in derselben Transaktion: Seine Fahrzeuge verlieren den Halter und die Notiz (Freitext); die Halterhistorie bleibt, ihre
 * offenen Einträge enden heute und ihre Notizen entfallen – sie zeigt danach auf den geleerten Stammsatz. Kennzeichen und FIN bleiben (Fahrzeugdaten, ohne Personenbezug).
 */
export const hooks: OperationHookDef[] = [
  {
    operation: "customers.anonymize",
    feature: "workshop.vehicles",
    run: async ({ tx, input }) => {
      const { id } = input as { id: string };
      await tx.vehicle.updateMany({ where: { customerId: id }, data: { customerId: null, notes: null } });
      await tx.vehicleOwnership.updateMany({ where: { customerId: id, toDate: null }, data: { toDate: new Date() } });
      await tx.vehicleOwnership.updateMany({ where: { customerId: id }, data: { note: null } });
    },
  },
];
