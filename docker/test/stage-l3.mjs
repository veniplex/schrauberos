// Stufe „l3“: der Starter in einem echten, winzigen Container (FROM scratch: das statische Starter-Binary mit Testschlüsseln, die Attrappe als Launcher) – ohne die App und ohne
// vollständigen Image-Bau. Hier zeigt sich, was nur Docker kann: PID 1 des Containers, `docker stop`, `docker exec` (darf nicht getötet werden), `--init` (Starter ist dann nicht PID 1,
// sondern Subreaper), gehärtete Optionen (read-only, cap_drop ALL, no-new-privileges) und der Betriebsbenutzer 1000. Die Stufe mit der echten App ist scripts/smoke-anchor.sh.
// Braucht die Docker-CLI und ein lokales Hilfsimage (alpine) für Dateioperationen im Volume.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { activate, buildDir, buildStarter, makePackage, removeTree, run, tempDir } from "./lib.mjs";
import { buildTestLauncher } from "./stage-starter.mjs";

const FLOOR = "0.2.0-dev.abc1234";
const IMAGE = "so-l3-starter:test";
const HELPER = process.env.SMOKE_HELPER_IMAGE ?? "alpine:latest";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Die Docker-CLI: direkt, oder – in WSL ohne Docker-Integration – docker.exe von Docker Desktop (dann brauchen Pfade Windows-Form: wslpath -w)
const DOCKER = (() => {
  for (const candidate of ["docker", "/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe"]) {
    if (run(candidate, ["version", "--format", "{{.Server.Version}}"]).status === 0) return candidate;
  }
  return null;
})();
const docker = (args, options = {}) => run(DOCKER ?? "docker", args, options);
const hostPath = (path) => (DOCKER?.endsWith(".exe") ? run("wslpath", ["-w", path]).stdout.trim() : path);

export async function l3Stage(log) {
  if (!DOCKER) {
    log("Docker ist nicht erreichbar – Stufe übersprungen.");
    return process.env.REQUIRE_NATIVE !== "1";
  }
  if (docker(["image", "inspect", HELPER]).status !== 0 && docker(["pull", "-q", HELPER]).status !== 0) {
    log(`Hilfsimage ${HELPER} nicht verfügbar – Stufe übersprungen.`);
    return process.env.REQUIRE_NATIVE !== "1";
  }

  // Image: nur Starter (Produktionskonstanten, Testschlüssel) + eingebaute Attrappe + /data und /tmp
  const launcher = buildTestLauncher();
  const starter = buildStarter(FLOOR, { tag: "l3", name: "starter-l3", production: true });
  const context = join(buildDir, "l3-context");
  removeTree(context);
  mkdirSync(join(context, "app", "runtime"), { recursive: true });
  mkdirSync(join(context, "skeleton", "data"), { recursive: true });
  mkdirSync(join(context, "skeleton", "tmp"), { recursive: true });
  run("cp", [starter, join(context, "bootstrap")]);
  run("cp", [launcher, join(context, "app", "runtime", "node")]);
  run("chmod", ["1777", join(context, "skeleton", "tmp")]);
  writeFileSync(join(context, "app", "launcher.mjs"), "include SOS_TEST_BUILTIN\n");
  writeFileSync(
    join(context, "Dockerfile"),
    "FROM scratch\nCOPY bootstrap /bootstrap\nCOPY app/ /app/\nCOPY --chown=1000:1000 skeleton/ /\nUSER 1000:1000\nENV DATA_DIR=/data SOS_TEST_LOG=/data/launcher.log SOS_TEST_BUILTIN=/data/builtin.script\nVOLUME [\"/data\"]\nENTRYPOINT [\"/bootstrap\"]\n",
  );
  const built = docker(["build", "-q", "-t", IMAGE, hostPath(context)]);
  if (built.status !== 0) throw new Error(`docker build: ${built.stderr}`);

  const failures = [];
  const check = (name, ok, detail = "") => {
    if (!ok) failures.push(`${name}${detail ? ": " + detail : ""}`);
  };
  const volumes = [];
  const containers = [];
  const workDirs = [];

  /** Volume mit Paket (aus einem Host-Verzeichnis), Zeiger und Skript der eingebauten Version. */
  const makeVolume = async ({ version = "0.3.0", script = "exit 0\n", builtinScript = "log builtin\nexit 0\n", sparse = {} } = {}) => {
    const dataDir = tempDir("so-l3-");
    workDirs.push(dataDir);
    const dir = await makePackage(dataDir, version, { launcherBinary: launcher, script, sparse });
    activate(dataDir, version);
    writeFileSync(join(dataDir, "builtin.script"), builtinScript);
    const vol = `so-l3-${process.pid}-${volumes.length}`;
    docker(["volume", "create", vol]);
    volumes.push(vol);
    // gross.bin & Co. (dünn besetzt) nicht kopieren, sondern im Volume neu anlegen
    for (const path of Object.keys(sparse)) run("mv", [join(dir, path), join(dataDir, `.sparse-${path}`)]);
    docker(["run", "--rm", "-v", `${vol}:/data`, HELPER, "mkdir", "-p", "/data/app/versions"]);
    const c = docker(["create", "-v", `${vol}:/data`, HELPER, "true"]).stdout.trim();
    docker(["cp", `${hostPath(dir)}${DOCKER.endsWith(".exe") ? "\\." : "/."}`, `${c}:/data/app/versions/${version}`]);
    docker(["cp", hostPath(join(dataDir, "builtin.script")), `${c}:/data/builtin.script`]);
    docker(["rm", c]);
    const fix = [`printf "%s" /data/app/versions/${version} > /data/app/active`, "chown -R 1000:1000 /data", `chmod -R a-w /data/app/versions/${version}`, "chmod u+w /data /data/app"];
    for (const [path, size] of Object.entries(sparse)) fix.unshift(`truncate -s ${size} /data/app/versions/${version}/${path}`);
    const r = docker(["run", "--rm", "-v", `${vol}:/data`, HELPER, "sh", "-c", fix.join(" && ")]);
    if (r.status !== 0) throw new Error(`Volume vorbereiten: ${r.stderr}`);
    return { vol, version };
  };
  const volSh = (vol, command) => docker(["run", "--rm", "-v", `${vol}:/data`, HELPER, "sh", "-c", command]);
  const fileInVolume = (container, path) => {
    const r = run("sh", ["-c", `"${DOCKER}" cp ${container}:${path} - 2>/dev/null | tar -xO 2>/dev/null`]);
    return r.status === 0 ? r.stdout : null;
  };
  let counter = 0;
  const start = (vol, options = [], { detach = true } = {}) => {
    const name = `so-l3-${process.pid}-c${counter++}`;
    containers.push(name);
    const r = docker(["run", ...(detach ? ["-d"] : []), "--name", name, "-v", `${vol}:/data`, ...options, IMAGE]);
    if (r.status !== 0) throw new Error(`docker run: ${r.stderr}`);
    return name;
  };
  const waitExit = async (name, timeoutMs = 60000) => {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const r = docker(["inspect", "-f", "{{.State.Status}} {{.State.ExitCode}}", name]).stdout.trim();
      if (r.startsWith("exited")) return Number(r.split(" ")[1]);
      await sleep(100);
    }
    return null;
  };
  const waitLog = async (name, path, pattern, timeoutMs = 20000) => {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const text = fileInVolume(name, path);
      if (text && pattern.test(text)) return text;
      await sleep(150);
    }
    return fileInVolume(name, path) ?? "";
  };
  const logs = (name) => docker(["logs", name]);
  const text = (name) => `${logs(name).stdout}${logs(name).stderr}`;

  try {
    // 1. Gutfall: PID 1, Betriebsbenutzer 1000
    {
      const { vol } = await makeVolume({ script: "uid\nppid\nlog installed\nexit 0\n" });
      const name = start(vol);
      const code = await waitExit(name);
      const out = text(name);
      const launcherLog = fileInVolume(name, "/data/launcher.log") ?? "";
      check("L3 Gutfall: Exit 0", code === 0, `${code}\n${out}`);
      check("L3 Gutfall: geprüft und installierte Version gestartet", /Version 0\.3\.0 geprüft/.test(out) && /installed/.test(launcherLog), `${out}\n${launcherLog}`);
      check("L3 Gutfall: Betriebsbenutzer 1000, Starter ist PID 1", /^uid 1000$/m.test(launcherLog) && /^ppid 1$/m.test(launcherLog), launcherLog);
    }

    // 2. docker stop (SIGTERM an PID 1) erreicht den Launcher
    {
      const { vol } = await makeVolume({ script: "wait-term 0\n" });
      const name = start(vol);
      check("L3 stop: Launcher bereit", /ready/.test(await waitLog(name, "/data/launcher.log", /ready/)));
      const t0 = Date.now();
      docker(["stop", "-t", "10", name]);
      const ms = Date.now() - t0;
      const code = await waitExit(name, 5000);
      check("L3 stop: Exit 0 in < 3 s (nicht erst nach dem Zeitlimit von docker stop)", code === 0 && ms < 3000, `${code} ${ms} ms`);
    }

    // 3. docker stop während der Prüfung
    {
      const { vol } = await makeVolume({ script: "log installed\nexit 0\n", sparse: { "gross.bin": 3 * 1024 ** 3 } });
      const name = start(vol);
      const seen = await (async () => {
        for (let i = 0; i < 100; i++) {
          if (/Prüfe Version 0\.3\.0/.test(text(name))) return true;
          await sleep(100);
        }
        return false;
      })();
      check("L3 stop in der Prüfung: Prüfung läuft", seen, text(name));
      await sleep(400);
      const t0 = Date.now();
      docker(["stop", "-t", "10", name]);
      const ms = Date.now() - t0;
      const launcherLog = fileInVolume(name, "/data/launcher.log") ?? "";
      const markers = fileInVolume(name, "/data/app/verify-failed") ?? fileInVolume(name, "/data/app/inconclusive");
      check("L3 stop in der Prüfung: beendet in < 2 s, kein Launcher, keine Marker", ms < 2000 && launcherLog === "" && !markers, `${ms} ms ${launcherLog} ${markers}`);
    }

    // 4. mit --init: der Starter ist nicht PID 1 (tini), sondern Subreaper – Überlebende werden trotzdem beendet
    for (const init of [false, true]) {
      const { vol } = await makeVolume({ script: "daemon /data/daemon.pid\nexit-once /data/flag 42\ncheck-dead /data/daemon.pid\nexit 0\n" });
      const name = start(vol, init ? ["--init"] : []);
      const code = await waitExit(name);
      const launcherLog = fileInVolume(name, "/data/launcher.log") ?? "";
      check(`L3 Ruhezustand (${init ? "--init, Starter nicht PID 1" : "Starter ist PID 1"}): Überlebender beim zweiten Lauf tot`, code === 0 && /^dead$/m.test(launcherLog) && !/^alive$/m.test(launcherLog), `${code}\n${launcherLog}\n${text(name)}`);
    }

    // 5. docker exec: ein Fremder (nicht Nachfahre des Starters) überlebt den Neustart des Launchers
    {
      const { vol } = await makeVolume({ script: "wait-file /data/go\nexit-once /data/flag 42\nlog run2\nwait-term 0\n" });
      const name = start(vol);
      // „docker exec“-Prozess: schreibt seine PID und wartet
      const hold = tempDir("so-l3-exec-");
      workDirs.push(hold);
      writeFileSync(join(hold, "exec.mjs"), "pidfile /data/exec.pid\nhold\n");
      writeFileSync(join(hold, "check.mjs"), "check-dead /data/exec.pid\n");
      const c = docker(["create", "-v", `${vol}:/data`, HELPER, "true"]).stdout.trim();
      docker(["cp", hostPath(join(hold, "exec.mjs")), `${c}:/data/exec.mjs`]);
      docker(["cp", hostPath(join(hold, "check.mjs")), `${c}:/data/check.mjs`]);
      docker(["rm", c]);
      docker(["exec", "-d", "-e", "SOS_TEST_LOG=/data/exec.log", name, "/app/runtime/node", "/data/exec.mjs"]);
      await waitLog(name, "/data/exec.pid", /\d+/);
      volSh(vol, "chown -R 1000:1000 /data && touch /data/go && chown 1000:1000 /data/go"); // der Launcher darf weiter: 42, der Starter prüft neu und beendet seine Nachfahren
      const second = await waitLog(name, "/data/launcher.log", /run2/, 30000);
      check("L3 docker exec: zweiter Lauf erreicht", /run2/.test(second), `${second}\n${text(name)}`);
      docker(["exec", "-e", "SOS_TEST_LOG=/data/exec-check.log", name, "/app/runtime/node", "/data/check.mjs"]);
      const verdict = fileInVolume(name, "/data/exec-check.log") ?? "";
      check("L3 docker exec: der fremde Prozess lebt noch (der Starter beendet nur seine Nachfahren)", /alive/.test(verdict), `${verdict}`);
      docker(["stop", "-t", "5", name]);
    }

    // 6. gehärtet: read-only, cap_drop ALL, no-new-privileges
    {
      const { vol } = await makeVolume({ script: "log installed\nexit 0\n" });
      const name = start(vol, ["--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--tmpfs", "/tmp:rw,mode=1777"]);
      const code = await waitExit(name);
      const out = text(name);
      check("L3 gehärtet: Gutfall läuft", code === 0 && /Version 0\.3\.0 geprüft/.test(out) && /installed/.test(fileInVolume(name, "/data/launcher.log") ?? ""), `${code}\n${out}`);
    }

    // 7. Manipulation im Volume: abgelehnt, eingebaute Version, Marker
    for (const [label, tamper, code] of [
      ["zusätzliche Datei", "touch /data/app/versions/0.3.0/fremd", 15],
      ["veränderte Datei", "printf x >> /data/app/versions/0.3.0/launcher.mjs", 16],
      ["node_modules neben der Version", "mkdir /data/app/versions/node_modules", 18],
    ]) {
      const { vol } = await makeVolume({ script: "log installed\nexit 0\n" });
      volSh(vol, tamper);
      const name = start(vol);
      const exit = await waitExit(name);
      const out = text(name);
      const launcherLog = fileInVolume(name, "/data/launcher.log") ?? "";
      const marker = fileInVolume(name, "/data/app/verify-failed");
      check(`L3 ${label}: abgelehnt (${code}), eingebaute Version`, exit === 0 && new RegExp(`abgelehnt \\(Code ${code}`).test(out) && /builtin/.test(launcherLog) && !/installed/.test(launcherLog) && marker?.startsWith(`0.3.0\n${code}\n`), `${exit}\n${out}\n${launcherLog}\n${marker}`);
    }

    // 8. Neustart des Containers prüft erneut
    {
      const { vol } = await makeVolume({ script: "log installed\nexit 0\n" });
      const name = start(vol);
      await waitExit(name);
      volSh(vol, "printf x >> /data/app/versions/0.3.0/launcher.mjs");
      docker(["start", name]);
      await sleep(300);
      await waitExit(name);
      check("L3 docker start nach Manipulation: abgelehnt", /abgelehnt \(Code 16/.test(text(name)), text(name));
    }
  } finally {
    for (const c of containers) docker(["rm", "-f", c]);
    for (const v of volumes) docker(["volume", "rm", "-f", v]);
    for (const d of workDirs) removeTree(d);
    docker(["rmi", "-f", IMAGE]);
  }
  log(failures.length ? `${failures.length} Abweichung(en)` : `alle Prüfungen bestanden (Image ${IMAGE}: nur Starter + Attrappe, Docker ${docker(["version", "--format", "{{.Server.Version}}"]).stdout.trim()})`);
  if (failures.length) log(failures.map((f) => `  ${f}`).join("\n"));
  return failures.length === 0;
}
