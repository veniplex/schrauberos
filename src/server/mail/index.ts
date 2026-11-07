/**
 * Öffentliche Seite des E-Mail-Versands für Fachfunktionen: `mailConfigured()` (Oberfläche: „Per E-Mail senden“ nur anbieten, wenn der Versand eingerichtet ist) und `queueMail(…)`
 * (in der Operation, in der Transaktion vormerken). Alles andere – Verbindung, Zustellung, Einstellungen – ist Sache der Plattform und der Funktion `admin.mail`.
 */
export { mailConfigured } from "./settings";
export { MAIL_MAX_ATTEMPTS, queueMail, type QueueMailInput } from "./queue";
export { MAIL_MAX_ATTACHMENT_BYTES, MAIL_MAX_ATTACHMENTS, MAIL_MAX_RECIPIENTS, type MailAttachmentRef } from "@/lib/mail";
