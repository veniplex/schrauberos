import "server-only";
import type { SetupCheckDef } from "@/modules/types";
import { mailConfigured } from "@/server/mail/settings";

/** Einrichtungsschritt: E-Mail-Versand (Empfehlung – ohne ihn bleiben Download und Druck, nur „Per E-Mail senden“ fehlt). */
export const setupChecks: SetupCheckDef[] = [
  { id: "mail", feature: "admin.mail", permission: "mail.manage", labelKey: "mail.checklist.label", hintKey: "mail.checklist.hint", href: "/settings?tab=mail", order: 35, recommended: true, done: async () => mailConfigured() },
];
