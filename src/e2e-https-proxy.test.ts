import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { startHttpsProxy, type HttpsProxy } from "../e2e/support/https-proxy";

/** Der TLS-Proxy der Browser-CI (e2e/tests/https.spec.ts) tut, was ein Reverse Proxy tut: HTTPS nach außen, HTTP nach innen mit Weiterleitungs-Kopfzeilen. */
let upstream: http.Server;
let proxy: HttpsProxy;
let seen: http.IncomingHttpHeaders = {};

before(async () => {
  upstream = http.createServer((req, res) => {
    seen = req.headers;
    res.setHeader("set-cookie", ["__Host-so_session=abc; Path=/; Secure; HttpOnly"]);
    res.end(`${req.method} ${req.url}`);
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const port = (upstream.address() as AddressInfo).port;
  proxy = await startHttpsProxy({ target: `http://127.0.0.1:${port}`, port: 45101 });
});
after(async () => {
  await proxy.close();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

const get = (path: string) =>
  new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    https
      .get(`${proxy.url}${path}`, { rejectUnauthorized: false }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      })
      .on("error", reject);
  });

describe("TLS-Proxy der Browser-CI", () => {
  it("leitet Anfragen per HTTP weiter und meldet HTTPS über x-forwarded-proto und x-forwarded-host", async () => {
    const res = await get("/login?x=1");
    assert.equal(res.status, 200);
    assert.equal(res.body, "GET /login?x=1");
    assert.equal(seen["x-forwarded-proto"], "https");
    assert.match(String(seen["x-forwarded-host"]), /^127\.0\.0\.1:45101$/);
    assert.match(res.headers["set-cookie"]?.[0] ?? "", /^__Host-so_session=abc; Path=\/; Secure/);
  });

  it("das Zertifikat ist selbstsigniert: ohne Ausnahme lehnt ein Client die Verbindung ab", async () => {
    await assert.rejects(
      new Promise((resolve, reject) => {
        https.get(proxy.url, (res) => resolve(res)).on("error", reject);
      }),
      /self.signed|SELF_SIGNED|certificate/i,
    );
  });
});
