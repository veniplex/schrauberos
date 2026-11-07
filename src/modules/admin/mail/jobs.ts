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
    // Verbindung (15 s) + Gruß (15 s) + Übertragung (15 MB Anhänge ≈ 20 MB Base64 brauchen bei 1 Mbit/s Upload rund 160 s): darüber hinaus gilt die Zustellung als gescheitert. Der Abnehmer bricht dann den
    // Versand ab (`signal` zerstört die Verbindungen), bevor die Wiederholung neu sendet. Unter dem Zeitlimit des Outbox-Jobs (5 min).
    timeoutMs: 200_000,
    handle: async (message, { signal }) => {
      const id = typeof message.payload.mailId === "string" ? message.payload.mailId : message.entityId;
      if (id) await deliverQueuedMail(id, { attempt: message.attempt, signal });
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
