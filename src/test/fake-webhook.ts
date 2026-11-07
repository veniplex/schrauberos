import https from "node:https";
import type { AddressInfo } from "node:net";
import selfsigned from "selfsigned";

/**
 * HTTPS-Empfänger **nur für Tests** (Webhooks): merkt sich jede Anfrage (Methode, Pfad, Köpfe, Body) und antwortet, wie die Option `respond` es vorgibt. Das Zertifikat ist selbst signiert
 * (`cert` als `ca` zulassen; ohne diese Zulassung muss die Zustellung an der Prüfung scheitern) und gilt für `localhost` und `127.0.0.1`.
 */
export type ReceivedHook = { method: string; path: string; headers: Record<string, string | string[] | undefined>; body: string };

export type FakeWebhookOptions = {
  /** Antwort je Anfrage (Standard: 204). `delayMs`: erst nach der Zeit antworten; `bodyBytes`: so viele Bytes Antworttext; `location`: Kopf für Weiterleitungen */
  respond?: (request: ReceivedHook, index: number) => { status: number; delayMs?: number; bodyBytes?: number; body?: string; location?: string };
};

export type FakeWebhookServer = { port: number; host: string; url: string; cert: string; requests: ReceivedHook[]; close(): Promise<void> };

export async function startFakeWebhook(options: FakeWebhookOptions = {}): Promise<FakeWebhookServer> {
  const pems = await selfsigned.generate([{ name: "commonName", value: "localhost" }], {
    notAfterDate: new Date(Date.now() + 2 * 86_400_000),
    keySize: 2048,
    extensions: [{ name: "subjectAltName", altNames: [{ type: 7, ip: "127.0.0.1" }, { type: 2, value: "localhost" }] }],
  });
  const requests: ReceivedHook[] = [];
  const server = https.createServer({ key: pems.private, cert: pems.cert }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const received: ReceivedHook = { method: req.method ?? "", path: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") };
      requests.push(received);
      const answer = options.respond?.(received, requests.length - 1) ?? { status: 204 };
      const send = () => {
        res.writeHead(answer.status, { ...(answer.location ? { location: answer.location } : {}), ...(answer.bodyBytes || answer.body ? { "content-type": "text/plain" } : {}) });
        res.end(answer.body ?? (answer.bodyBytes ? "x".repeat(answer.bodyBytes) : undefined));
      };
      if (answer.delayMs) setTimeout(send, answer.delayMs);
      else send();
    });
  });
  const sockets = new Set<import("node:net").Socket>();
  server.on("connection", (socket: import("node:net").Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    host: "127.0.0.1",
    url: `https://localhost:${port}/hook`,
    cert: pems.cert,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
