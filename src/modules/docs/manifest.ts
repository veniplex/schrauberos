import type { ModuleManifest } from "../types";
import { PinnedItDocs, PinnedOfficeDocs, PinnedWorkshopDocs } from "./widgets";

/** Dokumentation (Markdown) – je eine Wissenssammlung für Werkstatt, Büro und IT mit eigenen Rechten. */
export const docsModule: ModuleManifest = {
  id: "docs",
  nav: [
    { id: "docs-workshop", href: "/docs/workshop", labelKey: "nav.docs", icon: "docs", permission: "docsWorkshop.view", section: "workshop", order: 40 },
    { id: "docs-office", href: "/docs/office", labelKey: "nav.docs", icon: "docs", permission: "docsOffice.view", section: "office", order: 60 },
    { id: "docs-it", href: "/docs/it", labelKey: "nav.docs", icon: "docs", permission: "docsIt.view", section: "it", order: 64 },
  ],
  widgets: [
    { id: "docs-pinned-workshop", permission: "docsWorkshop.view", area: "workshop", span: 1, order: 30, Component: PinnedWorkshopDocs },
    { id: "docs-pinned-office", permission: "docsOffice.view", area: "office", span: 1, order: 60, Component: PinnedOfficeDocs },
    { id: "docs-pinned-it", permission: "docsIt.view", area: "it", span: 1, order: 70, Component: PinnedItDocs },
  ],
};
