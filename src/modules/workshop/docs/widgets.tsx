import { PinnedDocs } from "@/capabilities/docs/widgets";
import type { WidgetDef } from "@/modules/types";

export const widgets: WidgetDef[] = [
  { id: "docs-pinned-workshop", feature: "workshop.docs", permission: "docsWorkshop.view", span: 1, order: 30, Component: () => <PinnedDocs area="workshop" /> },
];
