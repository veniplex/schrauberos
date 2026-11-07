import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Kleiner WebDAV-Server im Speicher für Tests (nur `node:http`, nur auf 127.0.0.1): PROPFIND, MKCOL, PUT, GET, DELETE, MOVE mit Basic-Anmeldung.
 * Schalter für Fehlerfälle: Weiterleitungen, Ablehnung beim Schreiben, Antworten ohne Größenangabe.
 */
export type FakeWebdav = {
  url: string;
  port: number;
  files: Map<string, Buffer>;
  /** Zeitpunkt der letzten Änderung je Datei (RFC-1123-Text) */
  modified: Map<string, string>;
  requests: Array<{ method: string; path: string }>;
  options: { user: string; password: string; redirectTo: string | null; failPut: boolean; stallPut: boolean; omitLength: boolean; collectionExists: boolean };
  close(): Promise<void>;
};

const readBody = (request: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });

export async function startFakeWebdav(base = "/dav/backups"): Promise<FakeWebdav> {
  const files = new Map<string, Buffer>();
  const modified = new Map<string, string>();
  const requests: FakeWebdav["requests"] = [];
  const options: FakeWebdav["options"] = { user: "sicherung", password: "geheim", redirectTo: null, failPut: false, stallPut: false, omitLength: false, collectionExists: false };

  const entry = (name: string) =>
    `<D:response><D:href>${base}/${encodeURIComponent(name)}</D:href><D:propstat><D:prop><D:resourcetype/>${options.omitLength ? "" : `<D:getcontentlength>${files.get(name)!.length}</D:getcontentlength>`}<D:getlastmodified>${modified.get(name) ?? new Date().toUTCString()}</D:getlastmodified></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;

  const handler = async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const method = request.method ?? "GET";
    requests.push({ method, path: decodeURIComponent(url.pathname) });
    if (options.redirectTo) {
      response.writeHead(302, { Location: options.redirectTo }).end();
      return;
    }
    const expected = `Basic ${Buffer.from(`${options.user}:${options.password}`).toString("base64")}`;
    if (request.headers.authorization !== expected) {
      response.writeHead(401, { "WWW-Authenticate": 'Basic realm="x"' }).end();
      return;
    }
    const path = decodeURIComponent(url.pathname);
    const name = path.startsWith(`${base}/`) ? path.slice(base.length + 1) : null;
    if (method === "PROPFIND") {
      if (path !== base || !options.collectionExists) {
        response.writeHead(404).end();
        return;
      }
      const depth = request.headers.depth;
      const inner = depth === "0" ? "" : [...files.keys()].filter((n) => !n.includes("/")).map(entry).join("");
      response.writeHead(207, { "Content-Type": "application/xml" }).end(`<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>${base}/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>${inner}</D:multistatus>`);
      return;
    }
    if (method === "MKCOL" && path === base) {
      options.collectionExists = true;
      response.writeHead(201).end();
      return;
    }
    if (!name) {
      response.writeHead(404).end();
      return;
    }
    if (method === "PUT") {
      if (options.failPut) {
        request.resume();
        response.writeHead(507).end();
        return;
      }
      if (options.stallPut) {
        request.resume();
        return; // antwortet nie
      }
      files.set(name, await readBody(request));
      modified.set(name, new Date().toUTCString());
      response.writeHead(201).end();
      return;
    }
    if (method === "GET") {
      const data = files.get(name);
      if (!data) response.writeHead(404).end();
      else response.writeHead(200, { "Content-Length": data.length }).end(data);
      return;
    }
    if (method === "DELETE") {
      response.writeHead(files.delete(name) ? 204 : 404).end();
      return;
    }
    if (method === "MOVE") {
      const destination = new URL(String(request.headers.destination)).pathname;
      const to = decodeURIComponent(destination).slice(base.length + 1);
      const data = files.get(name);
      if (!data) {
        response.writeHead(404).end();
        return;
      }
      files.delete(name);
      files.set(to, data);
      modified.set(to, new Date().toUTCString());
      response.writeHead(201).end();
      return;
    }
    response.writeHead(405).end();
  };

  const server: Server = createServer((request, response) => void handler(request, response).catch(() => response.writeHead(500).end()));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}${base}`,
    port,
    files,
    modified,
    requests,
    options,
    close: () => new Promise<void>((resolve) => (server.closeAllConnections(), server.close(() => resolve()))),
  };
}
