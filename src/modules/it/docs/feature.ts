import { defineFeature } from "@/modules/define";

export const itDocsFeature = defineFeature({
  id: "docs",
  module: "it",
  nameKey: "docs.areas.it.title",
  descriptionKey: "docs.areas.it.description",
  order: 64,
  docsArea: "it",
  // IT-Tresor (F13): `docsIt.vault` zeigt Einträge und – nach erneuter Passwortabfrage – ihre Zugangsdaten, `docsIt.vaultManage` legt sie an, ändert und löscht sie (zusätzlich zu `docsIt.vault`).
  // Beide gelten **nur ausdrücklich** (`explicitOnly`): auch Administratoren haben sie nicht von selbst, sondern nur über eine Rolle, die sie enthält; gekennzeichnet (Regel 9), in keiner Standardrolle und in keinem Token.
  permissions: {
    group: "docsIt",
    keys: ["docsIt.view", "docsIt.edit", "docsIt.vault", "docsIt.vaultManage"],
    marked: { reveal: ["docsIt.vault"], sensitive: ["docsIt.vaultManage"] },
    explicitOnly: ["docsIt.vault", "docsIt.vaultManage"],
  },
  nav: [
    { id: "docs-it", href: "/docs/it", labelKey: "nav.docsIt", icon: "docs", permission: "docsIt.view", order: 64 },
    { id: "docs-vault", href: "/docs/vault", labelKey: "nav.vault", icon: "docs", permission: "docsIt.vault", order: 65 },
  ],
  quickActions: [{ id: "docsIt.new", labelKey: "docs.quick.itNew", href: "/docs/it/new", icon: "docs", permission: "docsIt.edit", order: 81 }],
  routes: ["docs/vault"],
  auditActions: ["vault.create", "vault.update", "vault.delete", "vault.reveal", "vault.revealFailed"],
});
