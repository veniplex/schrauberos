import http from "node:http";
import https from "node:https";
import selfsigned from "selfsigned";

/**
 * TLS-Proxy mit selbstsigniertem Zertifikat vor der App, wie ein Reverse Proxy im Betrieb (HTTPS nach außen, HTTP zur App, `x-forwarded-proto: https`).
 * Damit lässt sich im Browser prüfen, was über HTTPS anders ist: das `__Host-`-Cookie mit `Secure`, Abmelden, Cookie Tossing. Nur für Tests; der Browser
 * muss das Zertifikat ausdrücklich zulassen (Playwright: `ignoreHTTPSErrors`).
 */
export type HttpsProxy = { url: string; close: () => Promise<void> };

export async function startHttpsProxy(options: { target: string; port: number; host?: string }): Promise<HttpsProxy> {
  const host = options.host ?? "127.0.0.1";
  const pems = await selfsigned.generate([{ name: "commonName", value: host }], {
    notAfterDate: new Date(Date.now() + 2 * 86_400_000),
    keySize: 2048,
    extensions: [{ name: "subjectAltName", altNames: [{ type: 7, ip: "127.0.0.1" }, { type: 2, value: "localhost" }] }],
  });
  const target = new URL(options.target);
  const server = https.createServer({ key: pems.private, cert: pems.cert }, (req, res) => {
    const upstream = http.request(
      { host: target.hostname, port: target.port, method: req.method, path: req.url, headers: { ...req.headers, "x-forwarded-proto": "https", "x-forwarded-host": req.headers.host ?? "" } },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, host, () => resolve());
  });
  return {
    url: `https://${host}:${options.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
