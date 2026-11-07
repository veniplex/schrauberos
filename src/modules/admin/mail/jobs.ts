import { deliverQueuedMail, pruneMail } from "@/server/mail/deliver";
import { MAIL_MAX_ATTEMPTS } from "@/server/mail/queue";
import type { JobDef, OutboxHandlerDef } from "@/server/jobs/types";

/**
 * Versand über die Outbox: Ein Fachvorgang merkt die Nachricht vor (`queueMail`, in seiner Transaktion), der Abnehmer `mail.send` stellt sie zu – mit Wiederholung (30 s · 2ⁿ, höchstens 1 h) bis
 * `MAIL_MAX_ATTEMPTS`, danach steht sie als „fehlgeschlagen“ im Sendeprotokoll und das Ereignis als aufgegeben im Systemstatus. Das Ereignis trägt nur die ID der Nachricht, nie Empfänger oder Inhalt.
 * Ist die Funktion aus, bleibt das Ereignis geparkt. Ohne eingerichteten Versand scheitert die Zustellung mit dem Code `config` und wird wiederholt, bis jemand den Versand einrichtet.
 */
export const outboxHandlers: OutboxHandlerDef[] = [
  {
    id: "mail.send",
    feature: "admin.mail",
    types: ["mail.send"],
    maxAttempts: MAIL_MAX_ATTEMPTS,
    // Verbindung (15 s) + Gruß (15 s) + Leerlauf (30 s) + Übertragung: darüber hinaus gilt die Zustellung als gescheitert
    timeoutMs: 90_000,
    handle: async (message) => {
      const id = typeof message.payload.mailId === "string" ? message.payload.mailId : message.entityId;
      if (id) await deliverQueuedMail(id, { attempt: message.attempt });
    },
  },
];

/** Sendeprotokoll aufräumen: Inhalt aufgegebener Nachrichten nach 30 Tagen, Einträge nach einem Jahr. */
export const jobs: JobDef[] = [
  {
    id: "mail.prune",
    feature: "admin.mail",
    schedule: { cron: "40 3 * * *" },
    run: async ({ now }) => {
      const removed = await pruneMail(now);
      return removed > 0 ? `${removed} gelöscht` : undefined;
    },
  },
];
