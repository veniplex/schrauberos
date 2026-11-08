import http from "node:http";
import https from "node:https";
import net, { type AddressInfo } from "node:net";
import selfsigned from "selfsigned";

/**
 * Gegenstellen **nur für Tests** der Netzwerk-Überwachung: ein TCP-Server (zählt Verbindungen, hält sie auf Wunsch offen), ein HTTP-Server (merkt sich jede Anfrage samt Kopfzeilen, antwortet wie vorgegeben)
 * und ein HTTPS-Server mit selbst signiertem Zertifikat (gültig, abgelaufen oder für einen anderen Namen). Alles lauscht auf 127.0.0.1 – Tests erlauben Loopback dafür (`allowLoopbackForTests`).
 * Die Gültigkeit der Zertifikate ist **fest** (nie die reale Uhr): „gültig“ 2020–2099, „abgelaufen“ 2019–2020.
 */
export type SeenRequest = { method: string; url: string; headers: http.IncomingHttpHeaders; rawHeaders: string[] };
export type FakeAnswer = { status: number; location?: string; bodyBytes?: number; delayMs?: number; headers?: Record<string, string> };

type Closable = { port: number; close(): Promise<void> };

const sockets = (server: net.Server | http.Server | https.Server) => {
  const open = new Set<net.Socket>();
  server.on("connection", (socket: net.Socket) => {
    open.add(socket);
    socket.once("close", () => open.delete(socket));
  });
  return () => new Promise<void>((resolve) => {
    for (const socket of open) socket.destroy();
    server.close(() => resolve());
  });
};

/** TCP-Server: `hold` hält die Verbindung offen, ohne etwas zu senden; sonst wird sie sofort geschlossen. */
export async function startTcp(options: { hold?: boolean; delayMs?: number } = {}): Promise<Closable & { connections: number; concurrent: number; maxConcurrent: number }> {
  const state = { connections: 0, concurrent: 0, maxConcurrent: 0 };
  const server = net.createServer((socket) => {
    state.connections++;
    state.concurrent++;
    state.maxConcurrent = Math.max(state.maxConcurrent, state.concurrent);
    socket.on("error", () => undefined);
    socket.once("close", () => state.concurrent--);
    if (options.delayMs) setTimeout(() => socket.destroy(), options.delayMs);
    else if (!options.hold) socket.end();
  });
  const close = sockets(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return Object.defineProperties({ port, close } as Closable & typeof state, {
    connections: { get: () => state.connections },
    concurrent: { get: () => state.concurrent },
    maxConcurrent: { get: () => state.maxConcurrent },
  });
}

/** Gleichzeitig offene Anfragen (zählt von der Ankunft bis zum Ende der Antwort bzw. dem Abbruch der Verbindung) */
export type Inflight = { current: number; max: number };

function handler(requests: SeenRequest[], respond: (request: SeenRequest, index: number) => FakeAnswer, inflight: Inflight) {
  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    inflight.current++;
    inflight.max = Math.max(inflight.max, inflight.current);
    res.once("close", () => inflight.current--);
    const seen: SeenRequest = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, rawHeaders: req.rawHeaders };
    requests.push(seen);
    const answer = respond(seen, requests.length - 1);
    const send = () => {
      res.writeHead(answer.status, { ...(answer.location ? { location: answer.location } : {}), ...(answer.headers ?? {}), ...(answer.bodyBytes ? { "content-type": "text/plain" } : {}) });
      res.end(req.method === "HEAD" ? undefined : answer.bodyBytes ? "x".repeat(answer.bodyBytes) : undefined);
    };
    if (answer.delayMs) setTimeout(send, answer.delayMs);
    else send();
  };
}

export async function startHttp(respond: (request: SeenRequest, index: number) => FakeAnswer = () => ({ status: 200 })): Promise<Closable & { requests: SeenRequest[]; inflight: Inflight }> {
  const requests: SeenRequest[] = [];
  const inflight: Inflight = { current: 0, max: 0 };
  const server = http.createServer(handler(requests, respond, inflight));
  const close = sockets(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: (server.address() as AddressInfo).port, requests, inflight, close };
}

export type CertKind = "valid" | "expired";

export async function startHttps(respond: (request: SeenRequest, index: number) => FakeAnswer = () => ({ status: 200 }), cert: CertKind = "valid"): Promise<Closable & { requests: SeenRequest[]; cert: string }> {
  const pems = await selfsigned.generate([{ name: "commonName", value: "localhost" }], {
    notBeforeDate: new Date(cert === "valid" ? "2020-01-01T00:00:00Z" : "2019-01-01T00:00:00Z"),
    notAfterDate: new Date(cert === "valid" ? "2099-01-01T00:00:00Z" : "2020-01-01T00:00:00Z"),
    keySize: 2048,
    extensions: [{ name: "subjectAltName", altNames: [{ type: 7, ip: "127.0.0.1" }, { type: 2, value: "localhost" }] }],
  });
  const requests: SeenRequest[] = [];
  const server = https.createServer({ key: pems.private, cert: pems.cert }, handler(requests, respond, { current: 0, max: 0 }));
  // Handshake-Fehler (Gegenseite bricht ab) sind in Tests erwartet
  server.on("tlsClientError", () => undefined);
  const close = sockets(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: (server.address() as AddressInfo).port, requests, cert: pems.cert, close };
}
