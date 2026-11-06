import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";
import { FetchPolicyError, fetchWithPolicy, GITHUB_ASSET_HOSTS, type FetchPolicy } from "./safe-fetch";

/**
 * Abruf mit Token und Weiterleitungen gegen echte lokale Server: eine „API“ (127.0.0.1), ein erlaubter „Content-Server“ (localhost) und ein Fremdhost (127.0.0.2),
 * auf den die API umleitet. Geprüft wird, was jeder Server tatsächlich empfängt – vor allem, dass das Token nirgends außer bei der API ankommt.
 */
type Seen = { host: string; url: string; auth: string | null; accept: string | null };
const seen: Seen[] = [];
let api: Server;
let cdn: Server;
let evil: Server;
let apiPort = 0;
let cdnPort = 0;
let evilPort = 0;

/** Verhalten der API je Pfad: `redirect:<ziel>`, `ok`, `loop` */
let route: (req: IncomingMessage, res: ServerResponse) => void = () => undefined;

const record = (name: string) => (req: IncomingMessage, res: ServerResponse) => {
  seen.push({ host: name, url: req.url ?? "", auth: (req.headers.authorization as string | undefined) ?? null, accept: (req.headers.accept as string | undefined) ?? null });
  if (name === "api") return route(req, res);
  res.end(`inhalt von ${name}`);
};
const listen = (server: Server, host: string) => new Promise<number>((resolve, reject) => server.once("error", reject).listen(0, host, () => resolve((server.address() as AddressInfo).port)));

before(async () => {
  api = createServer(record("api"));
  cdn = createServer(record("cdn"));
  evil = createServer(record("evil"));
  apiPort = await listen(api, "127.0.0.1");
  cdnPort = await listen(cdn, "127.0.0.1"); // erreichbar unter localhost UND 127.0.0.1
  evilPort = await listen(evil, "127.0.0.2");
});
after(async () => {
  for (const s of [api, cdn, evil]) await new Promise((r) => s.close(r));
});
beforeEach(() => {
  seen.length = 0;
});

const policy = (extra: Partial<FetchPolicy> = {}): FetchPolicy => ({
  apiOrigin: `http://127.0.0.1:${apiPort}`,
  token: "geheim-token-123",
  redirectHosts: ["localhost"],
  requireHttps: false,
  timeoutMs: 5000,
  ...extra,
});
const apiUrl = (p = "/asset") => `http://127.0.0.1:${apiPort}${p}`;
const redirectTo = (target: string, status = 302) => {
  route = (_req, res) => {
    res.statusCode = status;
    res.setHeader("location", target);
    res.end();
  };
};
const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return null;
  } catch (error) {
    if (error instanceof FetchPolicyError) return error.code;
    throw error;
  }
};
const HEADERS = { Accept: "application/octet-stream" };

describe("Token nur an die API", () => {
  it("sendet das Token an die API und verfolgt die Weiterleitung zum erlaubten Content-Server OHNE Token", async () => {
    redirectTo(`http://localhost:${cdnPort}/blob?signatur=abc`);
    const res = await fetchWithPolicy(apiUrl(), HEADERS, policy());
    assert.equal(await res.text(), "inhalt von cdn");
    assert.deepEqual(
      seen.map((s) => [s.host, s.auth]),
      [
        ["api", "Bearer geheim-token-123"],
        ["cdn", null],
      ],
    );
    assert.equal(seen[1].accept, "application/octet-stream", "die übrigen Kopfzeilen bleiben");
    assert.equal(seen[1].url, "/blob?signatur=abc");
  });

  it("leitet die API auf einen Fremdhost um: abgelehnt, der Fremdhost bekommt nie eine Anfrage (und damit kein Token)", async () => {
    redirectTo(`http://127.0.0.2:${evilPort}/abgreifen`);
    assert.equal(await code(fetchWithPolicy(apiUrl(), HEADERS, policy())), "untrustedHost");
    assert.deepEqual(seen.map((s) => s.host), ["api"]);
  });

  it("Fremdhost-Ziel, das nur so aussieht: Unterdomain, Präfix, Zugangsdaten im Ziel", async () => {
    for (const target of [
      `http://localhost.evil.example:${cdnPort}/x`,
      `http://evil-localhost:${cdnPort}/x`,
      `http://localhost@127.0.0.2:${evilPort}/x`,
      `http://user:pw@localhost:${cdnPort}/x`,
    ]) {
      seen.length = 0;
      redirectTo(target);
      const result = await code(fetchWithPolicy(apiUrl(), HEADERS, policy()));
      assert.ok(result === "untrustedHost" || result === "badRedirect", `${target}: ${result}`);
      assert.deepEqual(seen.map((s) => s.host), ["api"], target);
    }
  });

  it("die Erstanfrage geht nur an die API-Herkunft: eine Asset-Adresse auf anderem Host oder Port wird gar nicht angefragt", async () => {
    assert.equal(await code(fetchWithPolicy(`http://127.0.0.2:${evilPort}/asset`, HEADERS, policy())), "untrustedHost");
    assert.equal(await code(fetchWithPolicy(`http://127.0.0.1:${cdnPort}/asset`, HEADERS, policy())), "untrustedHost", "gleicher Host, anderer Port");
    assert.equal(seen.length, 0);
  });

  it("HTTPS-Pflicht für Weiterleitungen (Standard): ein Klartext-Ziel wird abgelehnt, auch auf erlaubtem Host", async () => {
    redirectTo(`http://localhost:${cdnPort}/blob`);
    assert.equal(await code(fetchWithPolicy(apiUrl(), HEADERS, policy({ requireHttps: true }))), "badRedirect");
    assert.deepEqual(seen.map((s) => s.host), ["api"]);
  });

  it("Weiterleitungen: höchstens fünf, Ziel nötig, Ziel lesbar; alle Statuscodes 301/302/303/307/308", async () => {
    route = (_req, res) => {
      res.statusCode = 302;
      res.setHeader("location", `http://127.0.0.1:${apiPort}/schleife`);
      res.end();
    };
    assert.equal(await code(fetchWithPolicy(apiUrl(), HEADERS, policy())), "tooManyRedirects");
    assert.equal(seen.length, 6, "die erste Anfrage plus fünf Weiterleitungen");

    route = (_req, res) => {
      res.statusCode = 302;
      res.end();
    };
    assert.equal(await code(fetchWithPolicy(apiUrl(), HEADERS, policy())), "badRedirect", "Weiterleitung ohne Ziel");

    for (const status of [301, 302, 303, 307, 308]) {
      seen.length = 0;
      redirectTo(`http://localhost:${cdnPort}/blob`, status);
      assert.equal(await (await fetchWithPolicy(apiUrl(), HEADERS, policy())).text(), "inhalt von cdn", String(status));
    }
  });

  it("eine Weiterleitung innerhalb der API behält das Token nur bei Metadaten-Abfragen (sameOriginRedirectKeepsAuth), nie beim Asset-Download", async () => {
    let first = true;
    route = (req, res) => {
      if (first) {
        first = false;
        res.statusCode = 301;
        res.setHeader("location", "/repositories/42/releases/latest");
        return res.end();
      }
      res.end("json");
    };
    await (await fetchWithPolicy(apiUrl("/repos/a/b/releases/latest"), HEADERS, policy({ sameOriginRedirectKeepsAuth: true }))).text();
    assert.deepEqual(seen.map((s) => s.auth), ["Bearer geheim-token-123", "Bearer geheim-token-123"]);

    seen.length = 0;
    first = true;
    await (await fetchWithPolicy(apiUrl("/asset"), HEADERS, policy())).text();
    assert.deepEqual(seen.map((s) => s.auth), ["Bearer geheim-token-123", null], "beim Download geht das Token nie an ein Weiterleitungsziel");
  });

  it("ohne Token wird nie ein Authorization-Kopf gesendet", async () => {
    redirectTo(`http://localhost:${cdnPort}/blob`);
    await (await fetchWithPolicy(apiUrl(), HEADERS, policy({ token: null }))).text();
    assert.deepEqual(seen.map((s) => s.auth), [null, null]);
  });

  it("die Allowlist enthält die tatsächlichen GitHub-Content-Server (Stand der Prüfung gegen api.github.com und /meta)", () => {
    assert.ok(GITHUB_ASSET_HOSTS.includes("release-assets.githubusercontent.com"));
    assert.ok(GITHUB_ASSET_HOSTS.includes("objects.githubusercontent.com"));
    for (const host of GITHUB_ASSET_HOSTS) assert.match(host, /^[a-z-]+\.githubusercontent\.com$/);
    assert.equal(GITHUB_ASSET_HOSTS.some((h) => h.includes("*")), false, "keine Platzhalter");
  });
});
