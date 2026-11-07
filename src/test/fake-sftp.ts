import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import ssh2 from "ssh2";
import { fingerprintFromHex } from "@/lib/offsite/target";
import { allowLoopbackForTests } from "@/lib/offsite/host-policy";

/**
 * SFTP-Server im Speicher für Tests, gebaut mit dem Server-Teil von `ssh2` (nur auf 127.0.0.1): Passwort-Anmeldung, Dateien und Ordner im Speicher,
 * die Befehle OPEN/READ/WRITE/CLOSE/OPENDIR/READDIR/STAT/MKDIR/RENAME/REMOVE. Zeichnet Anmeldeversuche auf (um zu prüfen, dass bei falschem Hostschlüssel nie angemeldet wird).
 */
const { Server, utils } = ssh2;
const { OPEN_MODE, STATUS_CODE } = utils.sftp;

export type FakeSftp = {
  port: number;
  /** Fingerabdruck des Hostschlüssels im OpenSSH-Format */
  fingerprint: string;
  files: Map<string, Buffer>;
  dirs: Set<string>;
  authAttempts: number;
  options: { user: string; password: string };
  /** Test: lässt ein Umbenennen scheitern, wenn die Funktion `true` liefert (nach der Prüfung auf ein bestehendes Ziel) */
  failRename: ((from: string, to: string) => boolean) | null;
  close(): Promise<void>;
};

const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;

export async function startFakeSftp(): Promise<FakeSftp> {
  allowLoopbackForTests(); // das Ziel liegt auf 127.0.0.1; im Betrieb ist Loopback als Ziel verboten (lib/offsite/host-policy.ts)
  const hostKey = utils.generateKeyPairSync("ed25519");
  const parsed = utils.parseKey(hostKey.public);
  const key = Array.isArray(parsed) ? parsed[0] : parsed;
  if (key instanceof Error) throw key;
  const fingerprint = fingerprintFromHex(createHash("sha256").update(key.getPublicSSH()).digest("hex"));

  const files = new Map<string, Buffer>();
  const dirs = new Set<string>(["/"]);
  const state: { authAttempts: number; options: { user: string; password: string }; failRename: ((from: string, to: string) => boolean) | null } = { authAttempts: 0, options: { user: "sicherung", password: "geheim" }, failRename: null };
  const clients = new Set<{ end(): void }>();

  const server = new Server({ hostKeys: [hostKey.private] }, (client) => {
    clients.add(client);
    client.on("close", () => clients.delete(client));
    client.on("authentication", (ctx) => {
      state.authAttempts++;
      if (ctx.method === "password" && ctx.username === state.options.user && ctx.password === state.options.password) ctx.accept();
      else ctx.reject(["password"]);
    });
    client.on("error", () => undefined);
    client.on("ready", () => {
      client.on("session", (accept) => {
        const session = accept();
        session.on("sftp", (acceptSftp) => {
          const sftp = acceptSftp();
          const handles = new Map<number, { path: string; dir: boolean; sent: boolean; write: boolean }>();
          let next = 1;
          const handleBuffer = (id: number) => {
            const b = Buffer.alloc(4);
            b.writeUInt32BE(id);
            return b;
          };
          const idOf = (h: Buffer) => h.readUInt32BE(0);
          const attrsOf = (path: string) => {
            if (dirs.has(path)) return { mode: S_IFDIR | 0o755, size: 0, uid: 0, gid: 0, atime: 0, mtime: 0 };
            const data = files.get(path);
            return data ? { mode: S_IFREG | 0o644, size: data.length, uid: 0, gid: 0, atime: 0, mtime: Math.floor(Date.now() / 1000) } : null;
          };

          sftp.on("OPEN", (reqid, filename, flags) => {
            const write = !!(flags & OPEN_MODE.WRITE);
            if (!write && !files.has(filename)) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
            if (write && (flags & OPEN_MODE.TRUNC || !files.has(filename))) files.set(filename, Buffer.alloc(0));
            const id = next++;
            handles.set(id, { path: filename, dir: false, sent: false, write });
            sftp.handle(reqid, handleBuffer(id));
          });
          sftp.on("WRITE", (reqid, handle, offset, data) => {
            const h = handles.get(idOf(handle));
            if (!h) return sftp.status(reqid, STATUS_CODE.FAILURE);
            const current = files.get(h.path) ?? Buffer.alloc(0);
            const grown = Buffer.alloc(Math.max(current.length, offset + data.length));
            current.copy(grown);
            data.copy(grown, offset);
            files.set(h.path, grown);
            sftp.status(reqid, STATUS_CODE.OK);
          });
          sftp.on("READ", (reqid, handle, offset, length) => {
            const h = handles.get(idOf(handle));
            const data = h && files.get(h.path);
            if (!data) return sftp.status(reqid, STATUS_CODE.FAILURE);
            if (offset >= data.length) return sftp.status(reqid, STATUS_CODE.EOF);
            sftp.data(reqid, data.subarray(offset, offset + length));
          });
          sftp.on("FSTAT", (reqid, handle) => {
            const h = handles.get(idOf(handle));
            const attrs = h && attrsOf(h.path);
            if (!attrs) return sftp.status(reqid, STATUS_CODE.FAILURE);
            sftp.attrs(reqid, attrs);
          });
          sftp.on("CLOSE", (reqid, handle) => {
            handles.delete(idOf(handle));
            sftp.status(reqid, STATUS_CODE.OK);
          });
          sftp.on("OPENDIR", (reqid, path) => {
            if (!dirs.has(path)) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
            const id = next++;
            handles.set(id, { path, dir: true, sent: false, write: false });
            sftp.handle(reqid, handleBuffer(id));
          });
          sftp.on("READDIR", (reqid, handle) => {
            const h = handles.get(idOf(handle));
            if (!h || !h.dir || h.sent) return sftp.status(reqid, STATUS_CODE.EOF);
            h.sent = true;
            const prefix = h.path === "/" ? "/" : `${h.path}/`;
            const list = [...files.keys()]
              .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
              .map((p) => ({ filename: p.slice(prefix.length), longname: p.slice(prefix.length), attrs: attrsOf(p)! }));
            if (list.length === 0) return sftp.status(reqid, STATUS_CODE.EOF);
            sftp.name(reqid, list);
          });
          const stat = (reqid: number, path: string) => {
            const attrs = attrsOf(path);
            if (!attrs) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
            sftp.attrs(reqid, attrs);
          };
          sftp.on("STAT", stat);
          sftp.on("LSTAT", stat);
          sftp.on("MKDIR", (reqid, path) => {
            dirs.add(path);
            sftp.status(reqid, STATUS_CODE.OK);
          });
          sftp.on("RENAME", (reqid, from, to) => {
            const data = files.get(from);
            if (!data) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
            if (files.has(to)) return sftp.status(reqid, STATUS_CODE.FAILURE); // wie OpenSSH (SFTP v3): das Ziel darf nicht bestehen
            if (state.failRename?.(from, to)) return sftp.status(reqid, STATUS_CODE.FAILURE);
            files.delete(from);
            files.set(to, data);
            sftp.status(reqid, STATUS_CODE.OK);
          });
          sftp.on("REMOVE", (reqid, path) => {
            sftp.status(reqid, files.delete(path) ? STATUS_CODE.OK : STATUS_CODE.NO_SUCH_FILE);
          });
        });
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    fingerprint,
    files,
    dirs,
    get authAttempts() {
      return state.authAttempts;
    },
    options: state.options,
    get failRename() {
      return state.failRename;
    },
    set failRename(value) {
      state.failRename = value;
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of clients) client.end();
        server.close(() => resolve());
      }),
  } as FakeSftp;
}
