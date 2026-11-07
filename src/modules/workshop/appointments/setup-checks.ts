import "server-only";
import type { SetupCheckDef } from "@/modules/types";
import { db } from "@/server/db";

/** Einrichtungsschritt der Terminplanung: mindestens ein aktiver Arbeitsplatz und eine aktive Terminart. */
export const setupChecks: SetupCheckDef[] = [
  {
    id: "baysTypes",
    feature: "workshop.appointments",
    permission: "appointments.configure",
    labelKey: "appointments.checklist.baysTypes.label",
    hintKey: "appointments.checklist.baysTypes.hint",
    href: "/settings?tab=appointments",
    order: 12,
    done: async () => {
      const [bays, types] = await Promise.all([db.bay.count({ where: { active: true } }), db.appointmentType.count({ where: { active: true } })]);
      return bays > 0 && types > 0;
    },
  },
];
