import net from "node:net";
import tls from "node:tls";
import selfsigned from "selfsigned";

/**
 * Minimaler SMTP-Server **nur für Tests** (ohne Abhängigkeit, `node:net`/`node:tls`): spricht EHLO, STARTTLS, AUTH PLAIN/LOGIN, MAIL, RCPT, DATA, RSET, NOOP, QUIT und merkt sich alles, was ankommt.
 * Verhalten per Option: Anmeldung verlangen, STARTTLS anbieten oder gar nicht, SMTPS (TLS von der ersten Zeile an), Empfänger ablehnen, Antwort auf DATA vorgeben, Größenlimit.
 * Das Zertifikat ist selbst signiert (`cert` steht in `ca`, damit ein Test es gezielt als Zertifizierungsstelle zulassen kann – ohne diese Zulassung muss der Versand scheitern).
 */
export type ReceivedMail = { from: string; to: string[]; data: string };

export type FakeSmtpOptions = {
  /** Anmeldung verlangen: ohne gültiges AUTH antwortet der Server auf MAIL mit 530 */
  auth?: { user: string; pass: string };
  /** STARTTLS anbieten (Standard: nein) */
  startTls?: boolean;
  /** TLS von der ersten Zeile an (Anschluss 465) */
  implicitTls?: boolean;
  /** Empfänger ablehnen: Antwortzeile (z. B. `550 5.1.1 unknown`) oder null zum Annehmen */
  rejectRcpt?: (address: string) => string | null;
  /** Antwort auf das Ende der Daten (Standard `250 OK queued`) */
  dataReply?: string;
  /** Nach den Daten nie antworten (hängender Server: der Versand bleibt in der Übertragung stehen) */
  hangData?: boolean;
  /** Verzögerung vor dem Gruß in Millisekunden (für Zeitüberschreitungen) */
  greetingDelayMs?: number;
};

export type FakeSmtp = {
  port: number;
  host: string;
  /** Zertifikat des Servers (PEM): als `ca` zulassen, damit die Prüfung gelingt */
  cert: string;
  messages: ReceivedMail[];
  /** alle empfangenen Befehle (ohne Daten), AUTH-Zeilen geschwärzt */
  commands: string[];
  connections: number;
  /** Anzahl der Verbindungen, die schon wieder geschlossen sind */
  closedConnections: number;
  /** Anzahl der Verbindungen, die TLS ausgehandelt haben */
  tlsConnections: number;
  close(): Promise<void>;
};

export async function startFakeSmtp(options: FakeSmtpOptions = {}): Promise<FakeSmtp> {
  const pems = await selfsigned.generate([{ name: "commonName", value: "localhost" }], {
    notAfterDate: new Date(Date.now() + 2 * 86_400_000),
    keySize: 2048,
    extensions: [{ name: "subjectAltName", altNames: [{ type: 7, ip: "127.0.0.1" }, { type: 2, value: "localhost" }] }],
  });
  const state: FakeSmtp = { port: 0, host: "127.0.0.1", cert: pems.cert, messages: [], commands: [], connections: 0, closedConnections: 0, tlsConnections: 0, close: async () => {} };
  const sockets = new Set<net.Socket>();

  function serve(initial: net.Socket) {
    let socket: net.Socket = initial;
    sockets.add(socket);
    let buffer = "";
    let mode: "command" | "data" | "authPlain" | "authUser" | "authPass" = "command";
    let authenticated = !options.auth;
    let loginUser = "";
    let from = "";
    let to: string[] = [];
    let data = "";
    const send = (line: string) => socket.write(`${line}\r\n`);

    const attach = (s: net.Socket) => {
      s.setEncoding("utf8");
      s.on("data", (chunk: string) => {
        buffer += chunk;
        if (mode === "data") return drainData();
        drainLines();
      });
      s.on("error", () => {});
    };

    function drainData() {
      const end = buffer.indexOf("\r\n.\r\n");
      if (end < 0) return;
      data = buffer.slice(0, end).replace(/^\.\./gm, ".");
      buffer = buffer.slice(end + 5);
      state.messages.push({ from, to, data });
      from = "";
      to = [];
      mode = "command";
      if (options.hangData) return;
      send(options.dataReply ?? "250 OK queued");
      drainLines();
    }

    function checkAuth(user: string, pass: string) {
      if (options.auth && user === options.auth.user && pass === options.auth.pass) {
        authenticated = true;
        send("235 2.7.0 Authentication successful");
      } else send("535 5.7.8 Authentication credentials invalid");
    }

    function drainLines() {
      for (;;) {
        const at = buffer.indexOf("\r\n");
        if (at < 0 || mode === "data") return;
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        if (mode === "authPlain") {
          mode = "command";
          const [, user, pass] = Buffer.from(line, "base64").toString("utf8").split("\0");
          checkAuth(user ?? "", pass ?? "");
          continue;
        }
        if (mode === "authUser") {
          loginUser = Buffer.from(line, "base64").toString("utf8");
          mode = "authPass";
          send("334 UGFzc3dvcmQ6");
          continue;
        }
        if (mode === "authPass") {
          mode = "command";
          checkAuth(loginUser, Buffer.from(line, "base64").toString("utf8"));
          continue;
        }
        const upper = line.toUpperCase();
        state.commands.push(upper.startsWith("AUTH") ? "AUTH …" : line);
        if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
          const secure = socket instanceof tls.TLSSocket;
          send("250-localhost");
          send("250-SIZE 35882577");
          send("250-8BITMIME");
          if (options.startTls && !secure) send("250-STARTTLS");
          if (options.auth) send("250-AUTH PLAIN LOGIN");
          send("250 SMTPUTF8");
        } else if (upper === "STARTTLS" && options.startTls) {
          send("220 2.0.0 Ready to start TLS");
          const secure = new tls.TLSSocket(socket, { isServer: true, key: pems.private, cert: pems.cert });
          secure.on("secure", () => void state.tlsConnections++);
          sockets.add(secure);
          socket = secure;
          buffer = "";
          attach(secure);
          return;
        } else if (upper.startsWith("AUTH PLAIN")) {
          const inline = line.slice("AUTH PLAIN".length).trim();
          if (inline) {
            const [, user, pass] = Buffer.from(inline, "base64").toString("utf8").split("\0");
            checkAuth(user ?? "", pass ?? "");
          } else {
            mode = "authPlain";
            send("334 ");
          }
        } else if (upper.startsWith("AUTH LOGIN")) {
          mode = "authUser";
          send("334 VXNlcm5hbWU6");
        } else if (upper.startsWith("MAIL FROM:")) {
          if (!authenticated) send("530 5.7.0 Authentication required");
          else {
            from = /<([^>]*)>/.exec(line)?.[1] ?? "";
            to = [];
            send("250 OK");
          }
        } else if (upper.startsWith("RCPT TO:")) {
          const address = /<([^>]*)>/.exec(line)?.[1] ?? "";
          const rejection = options.rejectRcpt?.(address) ?? null;
          if (rejection) send(rejection);
          else {
            to.push(address);
            send("250 OK");
          }
        } else if (upper === "DATA") {
          mode = "data";
          send("354 End data with <CR><LF>.<CR><LF>");
          drainData();
          return;
        } else if (upper === "RSET" || upper === "NOOP") send("250 OK");
        else if (upper === "QUIT") {
          send("221 Bye");
          socket.end();
          return;
        } else send("500 5.5.1 Unrecognized command");
      }
    }

    attach(socket);
    const greet = () => send("220 localhost ESMTP fake");
    if (options.greetingDelayMs) setTimeout(greet, options.greetingDelayMs);
    else greet();
    initial.on("close", () => void state.closedConnections++);
    socket.on("close", () => sockets.delete(socket));
  }

  const server = options.implicitTls
    ? tls.createServer({ key: pems.private, cert: pems.cert }, (socket) => {
        state.connections++;
        state.tlsConnections++;
        serve(socket);
      })
    : net.createServer((socket) => {
        state.connections++;
        serve(socket);
      });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.port = (server.address() as net.AddressInfo).port;
  state.close = () =>
    new Promise<void>((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    });
  return state;
}
