import type { ModuleManifest } from "../types";
import { TireAttentionWidget, TireSwapWidget } from "./widgets";

export const tiresModule: ModuleManifest = {
  id: "tires",
  nav: [
    {
      id: "tires",
      href: "/tires",
      labelKey: "nav.tires",
      icon: "tires",
      permission: "tires.view",
      section: "workshop",
      order: 20,
    },
  ],
  widgets: [
    { id: "tire-attention", permission: "tires.view", area: "workshop", span: 1, order: 20, Component: TireAttentionWidget },
    { id: "tire-swap", permission: "tires.view", area: "workshop", span: 1, order: 21, Component: TireSwapWidget },
  ],
};
