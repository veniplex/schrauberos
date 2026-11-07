import "server-only";
import http from "node:http";
import https from "node:https";
import { ATTEMPT_TIMEOUT_MS, MAX_RESPONSE_BYTES, type DeliveryError } from "@/lib/webhooks/schedule";
import { checkWebhookUrl } from "@/lib/webhooks/url";
import { resolveWebhookTarget, WebhookError, type Lookup } from "./target";

/**
 * Ein HTTP-Versuch an ein Webhook-Ziel. Festgelegt (Tests in `webhooks.test.ts`):
 *  - Ziel **gesperrt** wie bei Mail/Off-Site (`target.ts`), die Verbindung geht an die **geprüfte IP-Adresse** (Name nur für SNI, `Host` und Zertifikatsprüfung),
 *  - **TLS-Prüfung an** (`rejectUnauthorized`, mindestens TLS 1.2); `http` nur zu einem Ziel mit privater Adresse und ausdrücklicher Freigabe,
 *  - **keine Weiterleitungen** (eine 3xx-Antwort ist ein Fehler, nichts wird nachgeladen), keine wiederverwendeten Verbindungen (`agent: false`),
 *  - **Zeitlimit** (10 s) für den ganzen Versuch, **Antwortgrenze** (8 KiB, der Rest wird abgebrochen): Gelesen wird nur der Statuscode – nie Text, Kopfzeilen oder Teile des Bodys gehen weiter.
 */
export type SendResult = { status: number; durationMs: number };

export type SendDeps = { lookup?: Lookup; ca?: string | Buffer | Array<string | Buffer>; signal?: AbortSignal; timeoutMs?: number };

/** Nur für Tests: eigene Zertifizierungsstelle des Fake-Servers und vorgegebene Namensauflösung. Im Betrieb wirkungslos – es wirft. */
export const webhookTestHooks: { ca?: SendDeps["ca"]; lookup?: Lookup } = {};
export function setWebhookTestHooks(hooks: { ca?: SendDeps["ca"]; lookup?: Lookup }): void {
  if (!process.env.NODE_TEST_CONTEXT) throw new Error("setWebhookTestHooks: nur in Tests");
  webhookTestHooks.ca = hooks.ca;
  webhookTestHooks.lookup = hooks.lookup;
}

/** Fehlercode eines Node-Fehlers (nie Text weitergeben). */
export function classifySendError(error: unknown): DeliveryError {
  if (error instanceof WebhookError) return error.code;
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns";
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") return "timeout";
  if (code === "ECONNRESET" || code === "EPIPE" || code === "ECONNABORTED") return "reset";
  if (code === "ECONNREFUSED" || code === "EHOSTUNREACH" || code === "ENETUNREACH" || code === "EADDRNOTAVAIL") return "connect";
  if (/^(ERR_TLS|ERR_SSL|CERT_|DEPTH_ZERO|UNABLE_TO|SELF_SIGNED|EPROTO|HOSTNAME_MISMATCH|ERR_OSSL)/.test(code)) return "tls";
  return "connect";
}

export async function postWebhook(rawUrl: string, options: { allowPrivate: boolean; headers: Record<string, string>; body: string }, deps: SendDeps = {}): Promise<SendResult> {
  const checked = checkWebhookUrl(rawUrl, { allowPrivate: options.allowPrivate });
  if (!checked.ok) throw new WebhookError(checked.problem === "forbiddenHost" || checked.problem === "privateNeedsApproval" ? "forbiddenHost" : "config");
  const url = checked.url;
  if (deps.signal?.aborted) throw new WebhookError("timeout");
  const target = await resolveWebhookTarget(url.hostname, { allowPrivate: options.allowPrivate }, deps.lookup ?? webhookTestHooks.lookup);
  const secure = url.protocol === "https:";
  // Klartext nur zu einem privaten Ziel (und nur mit Freigabe – sie steckt schon in `allowPrivate`)
  if (!secure && !(options.allowPrivate && target.private)) throw new WebhookError("config");

  const started = Date.now();
  const timeoutMs = deps.timeoutMs ?? ATTEMPT_TIMEOUT_MS;
  const bodyBytes = Buffer.from(options.body, "utf8");
  const headers: Record<string, string | number> = { ...options.headers, host: url.host, "content-length": bodyBytes.length, connection: "close" };
  const ca = deps.ca ?? webhookTestHooks.ca;

  return new Promise<SendResult>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      deps.signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const requestOptions: https.RequestOptions = {
      method: "POST",
      // Verbunden wird mit der geprüften Adresse; der Name dient nur SNI und der Zertifikatsprüfung
      host: target.address,
      family: target.family,
      port: url.port ? Number(url.port) : secure ? 443 : 80,
      path: `${url.pathname}${url.search}`,
      headers,
      agent: false,
      ...(secure ? { ...(target.servername ? { servername: target.servername } : {}), rejectUnauthorized: true, minVersion: "TLSv1.2" as const, ...(ca ? { ca } : {}) } : {}),
    };
    const req = (secure ? https : http).request(requestOptions, (res) => {
      const status = res.statusCode ?? 0;
      let size = 0;
      const done = () => finish(() => resolve({ status, durationMs: Date.now() - started }));
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        // Mehr als die Grenze wird nicht gelesen: Verbindung abbrechen, der Statuscode steht schon fest
        if (size > MAX_RESPONSE_BYTES) {
          done();
          res.destroy();
          req.destroy();
        }
      });
      res.on("end", done);
      res.on("error", done);
      res.on("close", done);
    });
    const onAbort = () => {
      req.destroy();
      finish(() => reject(new WebhookError("timeout")));
    };
    const timer = setTimeout(() => {
      req.destroy();
      finish(() => reject(new WebhookError("timeout")));
    }, timeoutMs);
    deps.signal?.addEventListener("abort", onAbort, { once: true });
    req.on("error", (error) => finish(() => reject(new WebhookError(classifySendError(error)))));
    req.end(bodyBytes);
  });
}
