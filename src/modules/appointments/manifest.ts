import type { ModuleManifest } from "../types";
import { TodayAppointmentsWidget } from "./widgets";

export const appointmentsModule: ModuleManifest = {
  id: "appointments",
  nav: [
    {
      id: "appointments",
      href: "/appointments",
      labelKey: "nav.appointments",
      icon: "calendar",
      permission: "appointments.view",
      section: "workshop",
      order: 10,
    },
  ],
  widgets: [
    { id: "today-appointments", permission: "appointments.view", area: "workshop", span: 2, order: 10, Component: TodayAppointmentsWidget },
  ],
};
