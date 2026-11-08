import net from "node:net";

/**
 * Ein winziger SMTP-Empfänger für die Browser-CI (nur Klartext, ohne Anmeldung): nimmt Nachrichten an und merkt sie sich. Damit lässt sich der Versand einer Rechnung
 * bis in den Postausgang prüfen, ohne einen echten Server – die Anwendung wird dafür wie von einem Anwender eingerichtet (Einstellungen → E-Mail, ohne Verschlüsselung
 * und mit Freigabe privater Adressen).
 */
export type ReceivedMail = { from: string; to: string[]; data: string };
export type FakeSmtp = { port: number; mails: ReceivedMail[]; close: () => Promise<void> };

export async function startFakeSmtp(): Promise<FakeSmtp> {
  const mails: ReceivedMail[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    let buffer = "";
    let inData = false;
    let current: ReceivedMail = { from: "", to: [], data: "" };
    const reply = (line: string) => socket.write(`${line}\r\n`);
    reply("220 fake-smtp ESMTP");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");
      for (;;) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end < 0) return;
          current.data = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          mails.push(current);
          current = { from: "", to: [], data: "" };
          inData = false;
          reply("250 2.0.0 queued");
          continue;
        }
        const newline = buffer.indexOf("\r\n");
        if (newline < 0) return;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);
        const command = line.slice(0, 4).toUpperCase();
        if (command === "EHLO") reply("250-fake-smtp\r\n250 8BITMIME");
        else if (command === "HELO") reply("250 fake-smtp");
        else if (command === "MAIL") {
          current = { from: /<([^>]*)>/.exec(line)?.[1] ?? "", to: [], data: "" };
          reply("250 2.1.0 ok");
        } else if (command === "RCPT") {
          current.to.push(/<([^>]*)>/.exec(line)?.[1] ?? "");
          reply("250 2.1.5 ok");
        } else if (command === "DATA") {
          inData = true;
          reply("354 end with <CRLF>.<CRLF>");
        } else if (command === "RSET" || command === "NOOP") reply("250 ok");
        else if (command === "QUIT") {
          reply("221 bye");
          socket.end();
          return;
        } else reply("502 not implemented");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    mails,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
