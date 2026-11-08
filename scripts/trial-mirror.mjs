// Spiegel der GitHub-API für Probeläufe der Update-Kette (nur lokal, nur mit Testschlüsseln – nie ein echtes Release):
//   node scripts/trial-mirror.mjs --dir <ordner> [--port 8080]
// Der Container der Anwendung bekommt `UPDATE_API_URL=http://<spiegel>:8080` (README „Starter-Vertrauensanker“, `src/modules/admin/updates/config.ts`: nur für Spiegel und Tests).
// Der Ordner enthält je Release einen Unterordner `<name>/` mit `manifest.json`, `manifest.json.sig`, `SOS-SEAL`, dem Paket (`schrauberos-<version>.tar.gz`) und optional
// `release-keys.json` (erzeugt von scripts/trial-release.mjs); die Datei `ACTIVE` im Ordner nennt, welches Release `GET /repos/<o>/<r>/releases/latest` gerade liefert (ohne Datei: 404).
// Der Spiegel liest ACTIVE bei jeder Anfrage: Zwischen zwei Prüfungen lässt sich das „neueste Release“ wechseln, ohne ihn neu zu starten.
import { createServer } from "node:http";
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const dir = resolve(arg("--dir", ""));
const port = Number(arg("--port", "8080"));
if (!arg("--dir")) throw new Error("Aufruf: node scripts/trial-mirror.mjs --dir <ordner> [--port 8080]");

const safe = (name) => /^[\w.-]+$/.test(name) && !name.startsWith(".");

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const log = (status, what) => console.log(`${new Date().toISOString()} ${req.method} ${url.pathname} -> ${status}${what ? " " + what : ""}`);
  const latest = url.pathname.match(/^\/repos\/[\w.-]+\/[\w.-]+\/releases\/latest$/);
  if (latest) {
    const active = existsSync(join(dir, "ACTIVE")) ? readFileSync(join(dir, "ACTIVE"), "utf8").trim() : "";
    if (!active || !safe(active) || !existsSync(join(dir, active))) {
      res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ message: "Not Found" }));
      return log(404, "kein ACTIVE");
    }
    const files = readdirSync(join(dir, active));
    const manifest = JSON.parse(readFileSync(join(dir, active, "manifest.json"), "utf8"));
    const body = {
      tag_name: `v${manifest.version}`,
      body: `Probe-Release ${active} (lokaler Spiegel, Testschlüssel)`,
      published_at: new Date().toISOString(),
      assets: files.map((name) => ({ name, size: statSync(join(dir, active, name)).size, url: `http://${req.headers.host}/assets/${active}/${name}` })),
    };
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
    return log(200, `${active} (v${manifest.version})`);
  }
  const asset = url.pathname.match(/^\/assets\/([\w.-]+)\/([\w.-]+)$/);
  if (asset && safe(asset[1]) && safe(asset[2]) && existsSync(join(dir, asset[1], asset[2]))) {
    const file = join(dir, asset[1], asset[2]);
    res.writeHead(200, { "content-type": "application/octet-stream", "content-length": statSync(file).size });
    createReadStream(file).pipe(res);
    return log(200, asset[2]);
  }
  res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ message: "Not Found" }));
  log(404);
}).listen(port, "0.0.0.0", () => console.log(`Spiegel auf Port ${port}, Ordner ${dir}`));
