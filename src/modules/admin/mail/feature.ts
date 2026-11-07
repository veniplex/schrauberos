import { defineFeature } from "@/modules/define";

/**
 * E-Mail-Versand (Plattformfunktion der Verwaltung, nur Versand): SMTP-Einstellungen im Reiter „E-Mail“ der Einstellungen, Sendeprotokoll, Test-Mail an die eigene Adresse.
 * Die Zustellung läuft über die Outbox (`jobs.ts`, Abnehmer `mail.send`); verschickt wird von den Fachfunktionen über `queueMail` (`src/server/mail`), erster Verbraucher: Angebote/Rechnungen (F3).
 * `mail.send` ist gekennzeichnet (Regel 9) und in keiner Standardrolle; die Einstellungen verwalten nur Administratoren.
 */
export const mailFeature = defineFeature({
  id: "mail",
  module: "admin",
  nameKey: "mail.feature.name",
  descriptionKey: "mail.feature.description",
  required: true,
  order: 138,
  permissions: { group: "mail", keys: ["mail.manage", "mail.send"], adminOnly: ["mail.manage"], marked: { send: ["mail.send"] } },
  nav: [],
  routes: [],
  auditActions: ["mail.settings", "mail.test", "mail.testSend", "mail.send", "mail.sendFailed", "mail.resend"],
});
