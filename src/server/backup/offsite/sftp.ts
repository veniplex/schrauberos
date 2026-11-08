import type { Client as SshClient, SFTPWrapper } from "ssh2";
import type { Readable, Writable } from "node:stream";
import { fingerprintFromHex, type RemoteEntry } from "@/lib/offsite/target";
import { OffsiteError, type OffsiteTransport } from "./transport";
import { resolvePinned } from "./resolve";
import { idleGuard } from "./webdav";

/**
 * SFTP-Ziel über `ssh2` (MIT; **reine JavaScript-Variante** – die optionalen nativen Teile `sshcrypto`/`cpu-features` werden nicht gebaut, `npm` führt ihre Install-Skripte wegen `allowScripts`
 * nicht aus; ssh2 fällt dann selbstständig auf JavaScript zurück). Die Bibliothek wird erst bei der Verwendung geladen (`import()`), ein Ladefehler trifft nur SFTP.
 *
 * **Hostschlüssel fest hinterlegt:** Verbunden wird nur, wenn der SHA-256-Fingerabdruck des Server-Hostschlüssels dem in den Einstellungen bestätigten entspricht (`hostKey`);
 * sonst Abbruch *vor* der Anmeldung (`OffsiteError("hostKey")` mit dem gesehenen Wert) – es werden nie Zugangsdaten an einen unbekannten Host gesendet.
 */
export type SftpConfig = {
  host: string;
  port: number;
  username: string;
  /** Verzeichnis am Ziel (absolut oder relativ zum Heimatverzeichnis) */
  path: string;
  /** Bestätigter Fingerabdruck (`SHA256:…`) */
  hostKey: string;
  credentials: { password?: string; privateKey?: string; passphrase?: string };
  readyTimeoutMs?: number;
  idleMs?: number;
};

type Ssh2 = typeof import("ssh2");
const loadSsh2 = async (): Promise<Ssh2> => {
  const loaded = (await import("ssh2")) as Ssh2 & { default?: Ssh2 };
  return loaded.Client ? loaded : (loaded.default as Ssh2);
};

type Listing = Array<{ filename: string; attrs: { size: number; mtime: number; isFile(): boolean } }>;
const NO_SUCH_FILE = 2;
/** Dateinamen am Ziel sind einfache Namen: nie ein Pfad */
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
const safe = (name: string) => {
  if (!SAFE_NAME.test(name) || name === "." || name === "..") throw new OffsiteError("config", "Dateiname");
  return name;
};

function mapError(error: unknown, extra?: { mismatch: boolean; seen: string }): OffsiteError {
  if (extra?.mismatch) return new OffsiteError("hostKey", undefined, extra.seen);
  if (error instanceof OffsiteError) return error;
  const e = error as { level?: string; code?: string | number; message?: string };
  if (e.level === "client-authentication") return new OffsiteError("auth");
  if (e.level === "client-timeout" || /timed out/i.test(e.message ?? "")) return new OffsiteError("timeout", "Verbindungsaufbau");
  if (e.code === NO_SUCH_FILE) return new OffsiteError("notFound");
  return new OffsiteError(typeof e.code === "string" ? "connect" : "server", typeof e.code === "string" ? e.code : (e.message ?? "ssh2").slice(0, 120));
}

/** Hostschlüssel eines Servers abrufen (zum Bestätigen beim Einrichten): Verbindung bis zum Schlüsselaustausch, dann Abbruch – es werden keine Zugangsdaten gesendet. */
export async function fetchSftpHostKey(host: string, port: number, timeoutMs = 15_000): Promise<string> {
  const pin = await resolvePinned(host); // nur die geprüfte Adresse wird verbunden (ZP5-6)
  const { Client } = await loadSsh2();
  return new Promise<string>((resolve, reject) => {
    const client = new Client();
    // Dauerhafter Zuhörer von Anfang an (Z6-2 N2): ssh2 meldet Protokoll- und Socketfehler an mehreren Stellen, auch mehrfach; nach dem ersten `once` gäbe es sonst keinen Zuhörer, und ein `error` ohne
    // Zuhörer beendet den Prozess (uncaughtException). Die Fehler erreichen die Aufrufer ohnehin über die Datenströme und Rückrufe der SFTP-Aufrufe.
    client.on("error", () => undefined);
    let seen = "";
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      client.destroy();
      fn();
    };
    client.on("error", (error) => settle(() => (seen ? resolve(seen) : reject(mapError(error)))));
    client.on("close", () => settle(() => (seen ? resolve(seen) : reject(new OffsiteError("connect", "Verbindung geschlossen")))));
    client.connect({
      host: pin.address,
      port,
      username: "hostkey-probe",
      readyTimeout: timeoutMs,
      hostHash: "sha256",
      hostVerifier: (hash: string) => {
        seen = fingerprintFromHex(hash);
        return false; // nur den Schlüssel sehen, nicht anmelden
      },
    });
  });
}

export class SftpTransport implements OffsiteTransport {
  private constructor(
    private readonly client: SshClient,
    private readonly sftp: SFTPWrapper,
    private readonly dir: string,
    private readonly idleMs: number,
  ) {}

  static async connect(config: SftpConfig): Promise<SftpTransport> {
    if (!config.credentials.password && !config.credentials.privateKey) throw new OffsiteError("config", "Zugangsdaten");
    const pin = await resolvePinned(config.host); // aufgelöst und geprüft; verbunden wird nur mit dieser Adresse (ZP5-6)
    const { Client } = await loadSsh2();
    const client = new Client();
    // Dauerhafter Zuhörer von Anfang an (Z6-2 N2): ssh2 meldet Protokoll- und Socketfehler an mehreren Stellen, auch mehrfach; nach dem ersten `once` gäbe es sonst keinen Zuhörer, und ein `error` ohne
    // Zuhörer beendet den Prozess (uncaughtException). Die Fehler erreichen die Aufrufer ohnehin über die Datenströme und Rückrufe der SFTP-Aufrufe.
    client.on("error", () => undefined);
    let seen = "";
    let mismatch = false;
    const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
      client.once("ready", () =>
        client.sftp((error, wrapper) => {
          if (error) {
            client.destroy();
            return reject(mapError(error));
          }
          resolve(wrapper);
        }),
      );
      client.once("error", (error) => reject(mapError(error, { mismatch, seen })));
      client.connect({
        host: pin.address,
        port: config.port,
        username: config.username,
        ...(config.credentials.password ? { password: config.credentials.password } : {}),
        ...(config.credentials.privateKey ? { privateKey: config.credentials.privateKey, ...(config.credentials.passphrase ? { passphrase: config.credentials.passphrase } : {}) } : {}),
        readyTimeout: config.readyTimeoutMs ?? 20_000,
        keepaliveInterval: 15_000,
        hostHash: "sha256",
        hostVerifier: (hash: string) => {
          seen = fingerprintFromHex(hash);
          if (seen === config.hostKey) return true;
          mismatch = true;
          return false;
        },
      });
    }).catch((error) => {
      client.destroy();
      throw error;
    });
    return new SftpTransport(client, sftp, config.path.replace(/\/+$/, "") || "/", config.idleMs ?? 120_000);
  }

  private path(name?: string): string {
    return name === undefined ? this.dir : this.dir === "/" ? `/${safe(name)}` : `${this.dir}/${safe(name)}`;
  }

  private call<T>(run: (done: (error: Error | null | undefined, value?: T) => void) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => run((error, value) => (error ? reject(mapError(error)) : resolve(value as T))));
  }

  /** Verzeichnis samt übergeordneten anlegen (mkdir -p). */
  private async ensureDir(): Promise<void> {
    const absolute = this.dir.startsWith("/");
    let current = absolute ? "" : ".";
    for (const part of this.dir.split("/").filter(Boolean)) {
      current = current === "." ? part : `${current}/${part}`;
      const here = absolute && !current.startsWith("/") ? `/${current}` : current;
      const exists = await this.call<boolean>((done) => this.sftp.stat(here, (error) => done(null, !error)));
      if (!exists) await this.call<void>((done) => this.sftp.mkdir(here, (error) => done(error)));
    }
  }

  async list(): Promise<RemoteEntry[]> {
    await this.ensureDir();
    const entries = await this.call<Listing>((done) => this.sftp.readdir(this.path(), (error, list) => done(error, list as unknown as Listing)));
    return entries
      .filter((e) => e.attrs.isFile())
      .map((e) => ({ name: e.filename, size: e.attrs.size, modifiedAt: e.attrs.mtime ? new Date(e.attrs.mtime * 1000) : null }));
  }

  async put(name: string, data: Readable, signal?: AbortSignal): Promise<void> {
    await this.ensureDir();
    const part = this.path(`${name}.part`);
    const final = this.path(name);
    const out = this.sftp.createWriteStream(part, { flags: "w", mode: 0o600 }) as unknown as Writable;
    const guard = idleGuard(this.idleMs, () => out.destroy(new OffsiteError("timeout", "keine Daten mehr")));
    try {
      await new Promise<void>((resolve, reject) => {
        const fail = (error: unknown) => {
          out.destroy();
          data.destroy();
          guard.destroy();
          reject(mapError(error));
        };
        data.once("error", fail);
        guard.once("error", fail);
        out.once("error", fail);
        out.once("close", () => resolve());
        if (signal) {
          if (signal.aborted) return fail(new OffsiteError("timeout", "abgebrochen"));
          signal.addEventListener("abort", () => fail(new OffsiteError("timeout", "abgebrochen")), { once: true });
        }
        data.pipe(guard).pipe(out);
      });
      await this.rename(part, final);
    } catch (error) {
      await this.call<void>((done) => this.sftp.unlink(part, (e) => done(e))).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Umbenennen. Das SFTP-Protokoll (Version 3) lehnt ab, wenn das Ziel besteht (Namen tragen einen Zeitstempel, das ist die Ausnahme). Dann wird die bestehende Datei **nicht gelöscht**,
   * sondern zuerst beiseitegelegt (`<Name>.old.part`), die neue eingesetzt und erst danach die alte entfernt; scheitert das Einsetzen, kommt die alte zurück – eine gültige Sicherung
   * geht so nie verloren (ZP5-10). Besteht das Ziel gar nicht, ist der Fehler ein anderer und wird weitergereicht.
   */
  private async rename(from: string, to: string): Promise<void> {
    const rename = (a: string, b: string) => this.call<void>((done) => this.sftp.rename(a, b, (error) => done(error)));
    const unlink = (file: string) => this.call<void>((done) => this.sftp.unlink(file, (error) => done(error)));
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const exists = await this.call<boolean>((done) => this.sftp.stat(to, (e) => done(null, !e)));
      if (!exists) throw error;
    }
    const aside = `${to}.old.part`;
    await unlink(aside).catch(() => undefined);
    await rename(to, aside);
    try {
      await rename(from, to);
    } catch (error) {
      await rename(aside, to).catch(() => undefined); // die alte Datei zurück
      throw error;
    }
    await unlink(aside).catch(() => undefined);
  }

  async get(name: string): Promise<Readable> {
    const file = this.path(name);
    const exists = await this.call<boolean>((done) => this.sftp.stat(file, (error) => done(null, !error)));
    if (!exists) throw new OffsiteError("notFound", name);
    const input = this.sftp.createReadStream(file) as unknown as Readable;
    const guard = idleGuard(this.idleMs, () => input.destroy(new OffsiteError("timeout", "keine Daten mehr")));
    input.once("error", (error: Error) => guard.destroy(mapError(error)));
    return input.pipe(guard);
  }

  async remove(name: string): Promise<void> {
    await this.call<void>((done) => this.sftp.unlink(this.path(name), (error) => done(error))).catch((error: OffsiteError) => {
      if (error.code !== "notFound") throw error;
    });
  }

  async close(): Promise<void> {
    this.client.end();
  }
}
