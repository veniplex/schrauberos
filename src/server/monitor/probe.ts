import "server-only";
import net from "node:net";
import tls from "node:tls";
import { CHECK_TIMEOUT_MS, classifyHttpStatus, type MonitorKind, type ProbeOutcome, type StatusClass } from "@/lib/monitor/model";
import { hostHeader, normalizeTarget } from "@/lib/monitor/target";
import { MonitorBlocked, resolveMonitorTarget, type Lookup, type PinnedAddress } from "./resolve";

/**
 * Eine Erreichbarkeitsprüfung – TCP-Verbindung oder HTTP(S)-Anfrage, **nie ICMP**. Festgelegt (Tests in `monitor.test.ts`):
 *  - Das Ziel wird zuerst **erneut gegen die Zielsperre** geprüft (`normalizeTarget`: die Datenbank könnte verändert sein), der Name einmal aufgelöst und **jede** Antwort geprüft (`resolve.ts`);
 *    verbunden wird mit der geprüften Adresse (bei mehreren der Reihe nach, jede mit einem Anteil der verbleibenden Zeit) – nie mit dem Namen.
 *  - **Zeitlimit** (5 s) für die ganze Prüfung. **Keine Weiterleitungen** (3xx ist eine Antwort: erreichbar, Klasse 3xx), keine wiederverwendeten Verbindungen (`Connection: close`).
 *  - HTTP: nur `HEAD` oder `GET`, die Anfrage wird von Hand mit genau drei Kopfzeilen (`Host`, fester `User-Agent`, `Connection: close`) gebaut – der Benutzer setzt keine; gelesen wird
 *    **nur die Statuszeile** (höchstens 4 KiB), dann wird die Verbindung geschlossen. Kein Body, keine Kopfzeilen der Antwort verlassen diese Funktion; zurück kommen Klasse und Latenz.
 *  - TLS: mindestens 1.2; ein Zertifikatsfehler (abgelaufen, fremder Aussteller, falscher Name) ist **kein Ausfall**, sondern die Warnung `tlsWarning` – außer `ignoreTlsErrors` ist gesetzt.
 *    Die Anfrage enthält nie Zugangsdaten, ein ungeprüfter Kanal verrät also nichts.
 */
export type ProbeTarget = { kind: string; host: string; port: number; path: string | null; method: string; ignoreTlsErrors: boolean };
/** `ca`: nur für Tests (Zertifikat des Fake-Servers als vertrauenswürdig) – im Betrieb übergibt es niemand. */
export type ProbeDeps = { timeoutMs?: number; lookup?: Lookup; ca?: string };

const MAX_STATUS_LINE = 4096;
const failed = (statusClass: StatusClass, latencyMs: number | null = null): ProbeOutcome => ({ ok: false, warn: false, latencyMs, statusClass });

/** Fehlercode eines Node-Fehlers → Klasse (nie Text weitergeben) */
function classifyConnectError(error: unknown): StatusClass {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
  if (code === "ECONNREFUSED") return "refused";
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") return "timeout";
  if (code === "EHOSTUNREACH" || code === "ENETUNREACH" || code === "EADDRNOTAVAIL" || code === "ENETDOWN" || code === "EHOSTDOWN") return "unreachable";
  return "error";
}

type Attempt = { connected: false; statusClass: StatusClass } | { connected: true; outcome: ProbeOutcome };

type Prepared = { kind: MonitorKind; host: string; port: number; path: string | null; method: string; ignoreTlsErrors: boolean; servername: string | null; ca?: string };

function attempt(address: PinnedAddress, target: Prepared, budgetMs: number): Promise<Attempt> {
  return new Promise<Attempt>((resolve) => {
    const started = performance.now();
    const elapsed = () => Math.max(0, Math.round(performance.now() - started));
    let settled = false;
    let tcpUp = false;
    let tlsUp = false;
    let tlsWarning = false;
    let socket: net.Socket;
    const finish = (value: Attempt) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket?.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish(tcpUp ? { connected: true, outcome: failed("timeout") } : { connected: false, statusClass: "timeout" }), Math.max(1, budgetMs));
    const fail = (statusClass: StatusClass) => finish(tcpUp ? { connected: true, outcome: failed(statusClass) } : { connected: false, statusClass });

    const sendRequest = () => {
      const request = `${target.method} ${target.path ?? "/"} HTTP/1.1\r\nHost: ${hostHeader(target.kind, target.host, target.port)}\r\nUser-Agent: SchrauberOS-Monitor\r\nAccept: */*\r\nConnection: close\r\n\r\n`;
      socket.write(request);
      let head = "";
      socket.on("data", (chunk: Buffer) => {
        head += chunk.toString("latin1");
        if (head.length > MAX_STATUS_LINE && !head.includes("\r\n")) return finish({ connected: true, outcome: failed("protocol") });
        const eol = head.indexOf("\r\n");
        if (eol < 0) return;
        const match = /^HTTP\/1\.[01] (\d{3})(?: |$)/.exec(head.slice(0, eol));
        if (!match) return finish({ connected: true, outcome: failed("protocol") });
        const verdict = classifyHttpStatus(Number(match[1]));
        const latencyMs = elapsed();
        if (!verdict.ok) return finish({ connected: true, outcome: failed(verdict.statusClass, latencyMs) });
        // Zertifikatsfehler sind eine Warnung, kein Ausfall (die Klasse nennt sie statt der HTTP-Klasse)
        if (tlsWarning) return finish({ connected: true, outcome: { ok: true, warn: true, latencyMs, statusClass: "tlsWarning" } });
        finish({ connected: true, outcome: { ok: true, warn: verdict.warn, latencyMs, statusClass: verdict.statusClass } });
      });
      // Schließt der Server ohne Statuszeile, ist das keine gültige Antwort
      socket.once("end", () => finish({ connected: true, outcome: failed("protocol") }));
    };

    if (target.kind === "https") {
      socket = tls.connect({
        host: address.address,
        port: target.port,
        // Der Name dient nur SNI und der Zertifikatsprüfung; verbunden wird mit der geprüften Adresse
        ...(target.servername ? { servername: target.servername } : {}),
        // Wir prüfen selbst: ein Zertifikatsfehler soll eine Warnung sein, kein Verbindungsabbruch
        rejectUnauthorized: false,
        minVersion: "TLSv1.2",
        ALPNProtocols: ["http/1.1"],
        ...(target.ca ? { ca: target.ca } : {}),
      });
      socket.once("secureConnect", () => {
        tlsUp = true;
        const secure = socket as tls.TLSSocket;
        tlsWarning = !secure.authorized && !target.ignoreTlsErrors;
        sendRequest();
      });
    } else {
      socket = net.connect({ host: address.address, port: target.port, family: address.family });
    }
    socket.once("connect", () => {
      tcpUp = true;
      if (target.kind === "tcp") finish({ connected: true, outcome: { ok: true, warn: false, latencyMs: elapsed(), statusClass: "open" } });
      else if (target.kind === "http") sendRequest();
    });
    socket.once("error", (error) => {
      if (!tcpUp) return fail(classifyConnectError(error));
      if (target.kind === "https" && !tlsUp) return fail("tls");
      fail(classifyConnectError(error));
    });
    socket.once("close", () => {
      if (!settled) fail(tcpUp ? (target.kind === "https" && !tlsUp ? "tls" : "error") : "unreachable");
    });
  });
}

export async function probeTarget(target: ProbeTarget, deps: ProbeDeps = {}): Promise<ProbeOutcome> {
  const timeoutMs = deps.timeoutMs ?? CHECK_TIMEOUT_MS;
  const started = performance.now();
  const remaining = () => timeoutMs - (performance.now() - started);

  // Erneute Prüfung dessen, was in der Datenbank steht
  const normalized = normalizeTarget({ kind: target.kind, host: target.host, port: target.port, path: target.path, method: target.method });
  if (!normalized.ok) return failed("blocked");
  const t = normalized.value;

  let resolved: Awaited<ReturnType<typeof resolveMonitorTarget>>;
  try {
    resolved = await resolveMonitorTarget(t.host, remaining(), deps.lookup);
  } catch (error) {
    return failed(error instanceof MonitorBlocked ? error.code : "dns");
  }

  let last: StatusClass = "error";
  for (let i = 0; i < resolved.addresses.length; i++) {
    const left = remaining();
    if (left <= 0) return failed("timeout");
    const result = await attempt(resolved.addresses[i], { ...t, ignoreTlsErrors: target.ignoreTlsErrors, servername: resolved.servername, ca: deps.ca }, left / (resolved.addresses.length - i));
    if (result.connected) return result.outcome;
    last = result.statusClass;
  }
  return failed(last);
}
