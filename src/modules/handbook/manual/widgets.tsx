import { PinnedDocs } from "@/capabilities/docs/widgets";
import type { WidgetDef } from "@/modules/types";

export const widgets: WidgetDef[] = [
  { id: "handbook-pinned", titleKey: "docs.areas.handbook.title", priority: 50, feature: "handbook.manual", permission: "handbook.view", span: 1, order: 30, Component: () => <PinnedDocs area="handbook" /> },
];
