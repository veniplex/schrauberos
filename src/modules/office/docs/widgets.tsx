import { PinnedDocs } from "@/capabilities/docs/widgets";
import type { WidgetDef } from "@/modules/types";

export const widgets: WidgetDef[] = [
  { id: "docs-pinned-office", feature: "office.docs", permission: "docsOffice.view", span: 1, order: 60, Component: () => <PinnedDocs area="office" /> },
];
