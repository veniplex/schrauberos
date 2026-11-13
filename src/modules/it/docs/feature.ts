import { defineFeature } from "@/modules/define";

export const itDocsFeature = defineFeature({
  id: "docs",
  module: "it",
  nameKey: "docs.areas.it.title",
  descriptionKey: "docs.areas.it.description",
  order: 64,
  docsArea: "it",
  // IT-Tresor (F13): `docs.vault` zeigt Einträge und – nach erneuter Passwortabfrage – ihre Zugangsdaten, `docs.vaultManage` legt sie an, ändert und löscht sie (zusätzlich zu `docs.vault`).
  // Beide gelten **nur ausdrücklich** (`explicitOnly`): auch Administratoren haben sie nicht von selbst, sondern nur über eine Rolle, die sie enthält; gekennzeichnet (Regel 9), in keiner Standardrolle und in keinem Token.
  permissions: {
    group: "docs",
    keys: ["docs.view", "docs.edit", "docs.vault", "docs.vaultManage"],
    marked: { reveal: ["docs.vault"], sensitive: ["docs.vaultManage"] },
    explicitOnly: ["docs.vault", "docs.vaultManage"],
  },
  nav: [
    { id: "docs-it", href: "/docs/it", labelKey: "nav.docs", icon: "docs", permission: "docs.view", order: 64 },
    { id: "docs-vault", href: "/docs/vault", labelKey: "nav.vault", icon: "docs", permission: "docs.vault", order: 65 },
  ],
  quickActions: [{ id: "docs.new", labelKey: "docs.quick.itNew", href: "/docs/it/new", icon: "docs", permission: "docs.edit", order: 81 }],
  routes: ["docs/vault"],
  auditActions: ["vault.create", "vault.update", "vault.delete", "vault.reveal", "vault.revealFailed", "vault.setup", "vault.unlock", "vault.unlockFailed", "vault.unlockRecovery", "vault.lock", "vault.passphrase", "vault.reset"],
});
