import { PinnedDocs } from "@/capabilities/docs/widgets";
import type { WidgetDef } from "@/modules/types";

export const widgets: WidgetDef[] = [
  { id: "docs-pinned-it", titleKey: "docs.areas.it.title", priority: 65, feature: "it.docs", permission: "docsIt.view", span: 1, order: 70, Component: () => <PinnedDocs area="it" /> },
];
