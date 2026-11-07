// Stufe „starter“: die Schleife des Starters (docker/bootstrap.c) mit einer Attrappe als Launcher (docker/test/test-launcher.c) – ohne Container.
// Geprüft werden: strenger Zeiger, Rückfall bei Ablehnung samt Markern, Klassen der Prüfergebnisse, Neustart über Code 42, Absturzfenster, Signale (auch während der Prüfung),
// Ruhezustand (Überlebende werden beendet, Fremde nicht), geerbte Signalmaske, Schnittstellen --print-keys, --verify (Aufruffehler) und --healthcheck.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { activate, buildStarter, buildDir, compile, headerDir, makePackage, removeTree, repo, run, tempDir } from "./lib.mjs";

const FLOOR = "0.2.0-dev.abc1234";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function buildTestLauncher() {
  return compile(join(buildDir, "test-launcher"), [join(repo, "docker/test/test-launcher.c")], ["-std=gnu11", "-O1", "-Wall", "-Wextra", "-static"]);
}

/** Das Umfeld der Starter-Tests: Attrappe, eingebaute Version (unverändert, wird nicht geprüft) und die Starter-Binaries. */
export function starterEnv({ crashWindow = 2, quiesceMs = 3000 } = {}) {
  const launcher = buildTestLauncher();
  const builtin = join(buildDir, "starter-builtin");
  mkdirSync(join(builtin, "runtime"), { recursive: true });
  run("cp", [launcher, join(builtin, "runtime", "node")]);
  chmodSync(join(builtin, "runtime", "node"), 0o755);
  writeFileSync(join(builtin, "launcher.mjs"), "include SOS_TEST_BUILTIN\n");
  const defs = (extra = []) => [`-DSOS_BUILTIN_DIR="${builtin}"`, `-DSOS_CRASH_WINDOW_SECONDS=${crashWindow}`, `-DSOS_QUIESCE_MILLIS=${quiesceMs}`, ...extra];
  return {
    launcher,
    builtin,
    starter: buildStarter(FLOOR, { tag: "test", extraDefs: defs(), name: "starter" }),
    starterShortTimeout: buildStarter(FLOOR, { tag: "test", extraDefs: defs(["-DSOS_VERIFY_TIMEOUT_SECONDS=1"]), name: "starter-timeout" }),
    starterNoQuiesce: buildStarter(FLOOR, { tag: "test", extraDefs: defs(["-DSOS_TEST_NO_QUIESCE=1"]), name: "starter-noquiesce" }),
    starterBackoff: buildStarter(FLOOR, { tag: "test", extraDefs: defs(["-DSOS_BACKOFF_STEP_MILLIS=200u"]), name: "starter-backoff" }),
  };
}

/** Startet den Starter mit eigenem Datenverzeichnis; liefert Hilfen zum Warten, Signalisieren und Auswerten. */
export function startStarter(env, binary, ctx, { builtinScript = "log builtin\nexit 0\n", args = [], wrap = [] } = {}) {
  const log = join(ctx.dataDir, "launcher.log");
  const builtinFile = join(ctx.dataDir, "builtin.script");
  writeFileSync(builtinFile, builtinScript);
  const started = Date.now();
  const command = wrap.length ? wrap[0] : binary;
  const child = spawn(command, wrap.length ? [...wrap.slice(1), binary, ...args] : args, { env: { PATH: process.env.PATH, DATA_DIR: ctx.dataDir, SOS_TEST_LOG: log, SOS_TEST_BUILTIN: builtinFile }, stdio: ["ignore", "pipe", "pipe"], detached: false });
  let stderr = "";
  let stdout = "";
  child.stderr.on("data", (d) => (stderr += d));
  child.stdout.on("data", (d) => (stdout += d));
  // „exit“ statt „close“: Ein Überlebender (Daemon) hält die Ausgabekanäle offen, bis er beendet wird – das darf den Test nicht aufhalten
  const done = new Promise((resolve) => child.on("exit", (code, signal) => setTimeout(() => resolve({ code, signal, stderr, stdout, ms: Date.now() - started }), 50)));
  const logText = () => (existsSync(log) ? readFileSync(log, "utf8") : "");
  return {
    child,
    done,
    log: logText,
    stderr: () => stderr,
    async waitFor(predicate, timeoutMs = 10000) {
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) {
        if (predicate()) return true;
        await sleep(20);
      }
      return false;
    },
    async finish(timeoutMs = 20000) {
      const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
      const result = await done;
      clearTimeout(timer);
      return result;
    },
  };
}

const readMarker = (dataDir, name) => (existsSync(join(dataDir, "app", name)) ? readFileSync(join(dataDir, "app", name), "utf8") : null);

export async function starterStage(log) {
  const env = starterEnv();
  const failures = [];
  let count = 0;
  const check = (name, condition, detail = "") => {
    count++;
    if (!condition) failures.push(`${name}${detail ? ": " + detail : ""}`);
  };

  const only = process.env.STARTER_ONLY;
  const scenario = async (name, fn) => {
    if (only && !name.includes(only)) return;
    const dataDir = tempDir("so-starter-");
    mkdirSync(join(dataDir, "app", "versions"), { recursive: true });
    const ctx = { dataDir, name };
    const outsiders = [];
    ctx.outsider = () => {
      const p = spawn("sleep", ["1000"], { detached: true, stdio: "ignore" });
      p.unref();
      outsiders.push(p);
      return p.pid;
    };
    try {
      await fn(ctx);
    } catch (error) {
      failures.push(`${name}: Ausnahme ${error.stack ?? error}`);
    } finally {
      for (const p of outsiders) {
        try {
          process.kill(-p.pid, "SIGKILL");
        } catch {
          /* schon weg */
        }
      }
      removeTree(dataDir);
    }
  };

  const install = (ctx, version, script, options = {}) => makePackage(ctx.dataDir, version, { launcherBinary: env.launcher, script, ...options });

  // ───── 1. Gutfall ─────
  await scenario("gutfall", async (ctx) => {
    await install(ctx, "0.3.0", "log installed\nexit 0\n");
    activate(ctx.dataDir, "0.3.0");
    const s = startStarter(env, env.starter, ctx);
    const r = await s.finish();
    check("gutfall: Exit 0", r.code === 0, `${r.code}/${r.signal} ${r.stderr}`);
    check("gutfall: der installierte Launcher lief, nicht der eingebaute", /^start .*versions\/0\.3\.0\/launcher\.mjs$/m.test(s.log()) && !/builtin/.test(s.log()), s.log());
    check("gutfall: Prüf- und Startzeilen", /Prüfe Version 0\.3\.0/.test(r.stderr) && /Version 0\.3\.0 geprüft \(\d+ Einträge/.test(r.stderr) && /Starte Launcher aus .*\/app\/versions\/0\.3\.0/.test(r.stderr), r.stderr);
    const ok = readMarker(ctx.dataDir, "verify-ok");
    check("gutfall: verify-ok", !!ok && /^0\.3\.0\n\d+\n\d+\n\d+\n\d{9,11}\n$/.test(ok), String(ok));
    check("gutfall: kein Fehlermarker", !readMarker(ctx.dataDir, "verify-failed") && !readMarker(ctx.dataDir, "inconclusive"));
  });

  // ───── 2. Ablehnungen: Marker, Rückfall auf die eingebaute Version ─────
  const rejections = [
    ["veränderte Datei", 16, "server.js", async (ctx, dir) => writeFileSync(join(dir, "server.js"), "// böse\n")],
    ["zusätzliche Datei", 15, ".versteckt", async (ctx, dir) => writeFileSync(join(dir, ".versteckt"), "x")],
    ["fehlende Datei", 14, "server.js", async (ctx, dir) => rmSync(join(dir, "server.js"))],
    ["Siegel fehlt", 10, "", async (ctx, dir) => rmSync(join(dir, "SOS-SEAL"))],
    ["Siegel beschädigt", 11, "", async (ctx, dir) => writeFileSync(join(dir, "SOS-SEAL"), (() => { const b = readFileSync(join(dir, "SOS-SEAL")); b[b.length - 20] ^= 1; return b; })())],
    ["node_modules neben der Version", 18, (ctx) => `${ctx.dataDir}/app/versions/node_modules`, async (ctx) => mkdirSync(join(ctx.dataDir, "app", "versions", "node_modules"))],
    ["Ausführbit entzogen", 16, "runtime/node", async (ctx, dir) => chmodSync(join(dir, "runtime", "node"), 0o644)],
  ];
  for (const [label, code, path, tamper] of rejections) {
    await scenario(`ablehnung ${label}`, async (ctx) => {
      const dir = await install(ctx, "0.3.0", "log installed\nexit 0\n", { files: { "server.js": "// server\n" } });
      await tamper(ctx, dir);
      activate(ctx.dataDir, "0.3.0");
      const s = startStarter(env, env.starter, ctx);
      const r = await s.finish();
      const marker = readMarker(ctx.dataDir, "verify-failed");
      check(`ablehnung ${label}: Exit 0 (eingebauter Launcher lief)`, r.code === 0 && /^start .*starter-builtin\/launcher\.mjs$/m.test(s.log()) && /builtin/.test(s.log()) && !/installed/.test(s.log()), `${r.code} ${s.log()} ${r.stderr}`);
      const expectedPath = typeof path === "function" ? path(ctx) : path;
      check(`ablehnung ${label}: Marker`, !!marker && marker === `0.3.0\n${code}\n${expectedPath}\n`, JSON.stringify(marker));
      check(`ablehnung ${label}: Meldung`, new RegExp(`Version 0\\.3\\.0 abgelehnt \\(Code ${code}`).test(r.stderr), r.stderr);
      check(`ablehnung ${label}: Zeiger unverändert`, readFileSync(join(ctx.dataDir, "app", "active"), "utf8") === join(ctx.dataDir, "app", "versions", "0.3.0"));
      check(`ablehnung ${label}: kein verify-ok`, !readMarker(ctx.dataDir, "verify-ok"));
    });
  }

  // ───── 2b. Hindernisse unter den Markernamen (die App kann sie vor dem Neustart anlegen): der Start darf nie ausgesperrt werden ─────
  const obstacles = [
    ["nicht leeres Verzeichnis", (p) => (mkdirSync(p), writeFileSync(join(p, "x"), "x"))],
    ["leeres Verzeichnis", (p) => mkdirSync(p)],
    ["Symlink auf eine Fremddatei", (p, ctx) => symlinkSync(join(ctx.dataDir, "outside.txt"), p)],
    ["FIFO", (p) => run("mkfifo", [p])],
  ];
  for (const [label, obstruct] of obstacles) {
    await scenario(`marker-hindernis verify-failed: ${label}`, async (ctx) => {
      const dir = await install(ctx, "0.3.0", "log installed\nexit 0\n");
      writeFileSync(join(dir, "extra.txt"), "x"); // -> 15
      activate(ctx.dataDir, "0.3.0");
      writeFileSync(join(ctx.dataDir, "outside.txt"), "ORIGINAL");
      obstruct(join(ctx.dataDir, "app", "verify-failed"), ctx);
      const s = startStarter(env, env.starter, ctx);
      const r = await s.finish(10000);
      check(`marker-hindernis ${label}: der Start läuft, die eingebaute Version startet`, r.code === 0 && /builtin/.test(s.log()) && !/installed/.test(s.log()), `${r.code}/${r.signal} ${s.log()} ${r.stderr}`);
      check(`marker-hindernis ${label}: der Marker ist eine Datei mit dem Befund`, readMarker(ctx.dataDir, "verify-failed") === "0.3.0\n15\nextra.txt\n", String(readMarker(ctx.dataDir, "verify-failed")));
      check(`marker-hindernis ${label}: die Fremddatei blieb unberührt`, readFileSync(join(ctx.dataDir, "outside.txt"), "utf8") === "ORIGINAL");
    });
  }
  await scenario("marker-hindernis launcher-crash als nicht leeres Verzeichnis", async (ctx) => {
    await install(ctx, "0.3.0", "log inst\nexit 3\n");
    activate(ctx.dataDir, "0.3.0");
    mkdirSync(join(ctx.dataDir, "app", "launcher-crash"));
    writeFileSync(join(ctx.dataDir, "app", "launcher-crash", "x"), "x");
    const s = startStarter(env, env.starter, ctx);
    const r = await s.finish(10000);
    check("marker-hindernis launcher-crash: Rückfall und Marker trotz Hindernis", r.code === 0 && /builtin/.test(s.log()) && readMarker(ctx.dataDir, "launcher-crash") === join(ctx.dataDir, "app", "versions", "0.3.0"), `${r.code} ${s.log()} ${readMarker(ctx.dataDir, "launcher-crash")}`);
  });
  await scenario("marker-hindernis inconclusive als nicht leeres Verzeichnis", async (ctx) => {
    await install(ctx, "0.3.0", "log installed\nexit 0\n");
    activate(ctx.dataDir, "0.3.0");
    mkdirSync(join(ctx.dataDir, "app", "inconclusive"));
    writeFileSync(join(ctx.dataDir, "app", "inconclusive", "x"), "x");
    const s = startStarter(env, env.starterNoQuiesce, ctx);
    const r = await s.finish(10000);
    check("marker-hindernis inconclusive: Marker trotz Hindernis", r.code === 0 && /builtin/.test(s.log()) && readMarker(ctx.dataDir, "inconclusive") === "0.3.0\nquiesce\n", `${r.code} ${s.log()} ${readMarker(ctx.dataDir, "inconclusive")}`);
  });
  await scenario("Marker nicht schreibbar: Logzeile, der Start läuft trotzdem", async (ctx) => {
    const dir = await install(ctx, "0.3.0", "log installed\nexit 0\n");
    writeFileSync(join(dir, "extra.txt"), "x");
    activate(ctx.dataDir, "0.3.0");
    mkdirSync(join(ctx.dataDir, "app", "verify-failed"));
    writeFileSync(join(ctx.dataDir, "app", "verify-failed", "x"), "x");
    chmodSync(join(ctx.dataDir, "app"), 0o555); // kein Anlegen, kein Entfernen, kein Verschieben
    const s = startStarter(env, env.starter, ctx);
    const r = await s.finish(10000);
    chmodSync(join(ctx.dataDir, "app"), 0o755);
    check("Marker nicht schreibbar: Warnzeile und eingebaute Version", r.code === 0 && /builtin/.test(s.log()) && /Der Marker verify-failed lässt sich nicht schreiben/.test(r.stderr), `${r.code} ${s.log()} ${r.stderr}`);
  });

  // ───── 3. veraltet (19): kein Marker, kein Alarm ─────
  await scenario("veraltet", async (ctx) => {
    await install(ctx, "0.2.0", "log installed\nexit 0\n"); // gleich der Untergrenze 0.2.0-dev…? 0.2.0 liegt darüber
    const equal = await install(ctx, "0.2.5", "log installed\nexit 0\n", { base: 3 }); // andere Basis
    void equal;
    activate(ctx.dataDir, "0.2.5");
    const s = startStarter(env, env.starter, ctx);
    const r = await s.finish();
    check("veraltet (base): eingebaute Version, keine Marker", r.code === 0 && /builtin/.test(s.log()) && !readMarker(ctx.dataDir, "verify-failed") && !readMarker(ctx.dataDir, "inconclusive"), `${s.log()} ${r.stderr}`);
    check("veraltet: Logzeile", /veraltet oder passt nicht/.test(r.stderr), r.stderr);
  });
  await scenario("veraltet (Untergrenze)", async (ctx) => {
    await install(ctx, "0.1.5", "log installed\nexit 0\n");
    activate(ctx.dataDir, "0.1.5");
    const s = startStarter(env, env.starter, ctx);
    const r = await s.finish();
    check("Untergrenze: eingebaute Version, keine Marker", r.code === 0 && /builtin/.test(s.log()) && !readMarker(ctx.dataDir, "verify-failed") && !readMarker(ctx.dataDir, "inconclusive"), `${s.log()} ${r.stderr}`);
  });

  // ───── 4. Der Zeiger ist streng ─────
  const pointerCases = [
    ["leer", ""],
    ["relativ", "app/versions/0.3.0"],
    ["fremdes Verzeichnis", "/etc"],
    ["mit ..", (d) => `${d}/app/versions/../versions/0.3.0`],
    ["führende Null", (d) => `${d}/app/versions/00.3.0`],
    ["Vorabversion", (d) => `${d}/app/versions/0.3.0-rc1`],
    ["Unterordner", (d) => `${d}/app/versions/0.3.0/runtime`],
    ["Leerzeichen am Ende", (d) => `${d}/app/versions/0.3.0 `],
    ["zwei Zeilen", (d) => `${d}/app/versions/0.3.0\n${d}/app/versions/0.3.0\n`],
    ["CRLF", (d) => `${d}/app/versions/0.3.0\r\n`],
    ["Steuerzeichen", (d) => `${d}/app/versions/0.3.\u00010`],
    ["zu lang", (d) => `${d}/app/versions/${"1".repeat(5000)}`],
    ["zehnstellige Zahl", (d) => `${d}/app/versions/0.3.1234567890`],
    ["nicht vorhandene Version", (d) => `${d}/app/versions/0.9.9`],
  ];
  for (const [label, content] of pointerCases) {
    await scenario(`zeiger ${label}`, async (ctx) => {
      await install(ctx, "0.3.0", "log installed\nexit 0\n");
      writeFileSync(join(ctx.dataDir, "app", "active"), typeof content === "function" ? content(ctx.dataDir) : content);
      const s = startStarter(env, env.starter, ctx);
      const r = await s.finish();
      check(`zeiger ${label}: eingebaute Version ohne Marker`, r.code === 0 && /builtin/.test(s.log()) && !/installed/.test(s.log()) && !readMarker(ctx.dataDir, "verify-failed") && !readMarker(ctx.dataDir, "inconclusive") && !readMarker(ctx.dataDir, "verify-ok"), `${r.code} ${s.log()} ${r.stderr}`);
    });
  }
  await scenario("zeiger mit Zeilenende (erlaubt)", async (ctx) => {
    await install(ctx, "0.3.0", "log installed\nexit 0\n");
    writeFileSync(join(ctx.dataDir, "app", "active"), `${ctx.dataDir}/app/versions/0.3.0\n`);
    const s = startStarter(env, env.starter, ctx);
    const r = await s.finish();
    check("zeiger mit einem Zeilenende: installierte Version", r.code === 0 && /installed/.test(s.log()), `${s.log()} ${r.stderr}`);
  });
  await scenario("zeiger DATA_DIR mit Schrägstrich am Ende", async (ctx) => {
    await install(ctx, "0.3.0", "log installed\nexit 0\n");
    activate(ctx.dataDir, "0.3.0");
    writeFileSync(join(ctx.dataDir, "builtin.script"), "log builtin\nexit 0\n");
    // Mit „/“ am Ende von DATA_DIR: der Zeiger der App (path.join) trägt keinen doppelten Schrägstrich
    const slash = spawn(env.starter, [], { env: { PATH: process.env.PATH, DATA_DIR: `${ctx.dataDir}/`, SOS_TEST_LOG: join(ctx.dataDir, "launcher.log"), SOS_TEST_BUILTIN: join(ctx.dataDir, "builtin.script") }, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    slash.stderr.on("data", (d) => (err += d));
    const code = await new Promise((resolve) => slash.on("close", resolve));
    check("DATA_DIR mit Schrägstrich am Ende", code === 0 && /Version 0\.3\.0 geprüft/.test(err), `${code} ${err}`);
  });
  await scenario("zeiger ist ein Verzeichnis / Link / FIFO", async (ctx) => {
    await install(ctx, "0.3.0", "log installed\nexit 0\n");
    const active = join(ctx.dataDir, "app", "active");
    // Verzeichnis
    mkdirSync(active);
    let s = startStarter(env, env.starter, ctx);
    let r = await s.finish();
    check("Zeiger als Verzeichnis: eingebaute Version", r.code === 0 && /builtin/.test(s.log()), `${r.code} ${s.log()}`);
    rmSync(active, { recursive: true });
    // Symlink auf eine gültige Zeigerdatei
    writeFileSync(join(ctx.dataDir, "app", "echt"), join(ctx.dataDir, "app", "versions", "0.3.0"));
    symlinkSync(join(ctx.dataDir, "app", "echt"), active);
    rmSync(join(ctx.dataDir, "launcher.log"), { force: true });
    s = startStarter(env, env.starter, ctx);
    r = await s.finish();
    check("Zeiger als Symlink: eingebaute Version", r.code === 0 && /builtin/.test(s.log()) && !/installed/.test(s.log()), `${r.code} ${s.log()}`);
    rmSync(active);
    // FIFO: darf den Start nie aussperren
    run("mkfifo", [active]);
    rmSync(join(ctx.dataDir, "launcher.log"), { force: true });
    s = startStarter(env, env.starter, ctx);
    r = await s.finish(8000);
    check("Zeiger als FIFO: Start hängt nicht, eingebaute Version", r.code === 0 && /builtin/.test(s.log()) && r.ms < 5000, `${r.code}/${r.signal} ${r.ms} ms ${s.log()}`);
  });

  // ───── 5. Neustart über Code 42: jedes Mal wird neu geprüft ─────
  await scenario("neustart 42", async (ctx) => {
    await install(ctx, "0.3.0", `exit-once ${ctx.dataDir}/flag 42\nlog second\nexit 0\n`);
    activate(ctx.dataDir, "0.3.0");
    const s = startStarter(env, env.starter, ctx);
    const r = await s.finish();
    const checks = (r.stderr.match(/Prüfe Version 0\.3\.0/g) ?? []).length;
    check("neustart 42: zweimal geprüft, zweimal gestartet, Exit 0", r.code === 0 && checks === 2 && (s.log().match(/^start /gm) ?? []).length === 2 && /second/.test(s.log()), `${r.code} Prüfungen ${checks}\n${s.log()}\n${r.stderr}`);
  });
  await scenario("neustart 42 nach Manipulation", async (ctx) => {
    // „Die App“ (der Launcher als kompromittierter Code) verändert ihr eigenes Paket und meldet 42: Der Starter prüft neu und lehnt ab – der veränderte Code läuft nie wieder
    const dir = join(ctx.dataDir, "app", "versions", "0.3.0");
    await install(ctx, "0.3.0", `log first\nappend ${dir}/server.js manipuliert\nexit 42\nlog nie\n`, { files: { "server.js": "// ok\n" } });
    activate(ctx.dataDir, "0.3.0");
    const s = startStarter(env, env.starter, ctx);
    const r = await s.finish();
    const marker = readMarker(ctx.dataDir, "verify-failed");
    check("neustart nach Manipulation: der installierte Code läuft nur einmal, danach die eingebaute Version", r.code === 0 && (s.log().match(/^first$/gm) ?? []).length === 1 && !/nie/.test(s.log()) && /builtin/.test(s.log()), `${r.code} ${s.log()} ${r.stderr}`);
    check("neustart nach Manipulation: Marker 16 server.js", marker === "0.3.0\n16\nserver.js\n", String(marker));
  });

  // ───── 6. Absturzfenster ─────
  await scenario("absturz zweimal sofort", async (ctx) => {
    await install(ctx, "0.3.0", "log installed-crash\nexit 3\n");
    activate(ctx.dataDir, "0.3.0");
    const s = startStarter(env, env.starter, ctx);
    const r = await s.finish();
    const runs = (s.log().match(/installed-crash/g) ?? []).length;
    check("absturz: zwei Läufe der installierten Version, danach die eingebaute", r.code === 0 && runs === 2 && /builtin/.test(s.log()), `${r.code} ${runs}\n${s.log()}\n${r.stderr}`);
    check("absturz: Marker launcher-crash", readMarker(ctx.dataDir, "launcher-crash") === join(ctx.dataDir, "app", "versions", "0.3.0"), String(readMarker(ctx.dataDir, "launcher-crash")));
  });
  await scenario("absturz nach Laufzeit zählt nicht doppelt", async (ctx) => {
    // jeder Lauf lebt länger als das Fenster (2 s): kein Rückfall
    await install(ctx, "0.3.0", "log slow-crash\nsleep 2300\nexit 3\n");
    activate(ctx.dataDir, "0.3.0");
    const s = startStarter(env, env.starter, ctx);
    const reached = await s.waitFor(() => (s.log().match(/slow-crash/g) ?? []).length >= 3, 30000);
    s.child.kill("SIGTERM");
    const r = await s.finish();
    check("langsamer Absturz: nach drei Läufen kein Rückfall, kein Marker", reached && !readMarker(ctx.dataDir, "launcher-crash") && !/builtin/.test(s.log()), `${s.log()} ${r.stderr}`);
  });
  await scenario("langsamer Absturz, dann schnelle: der langsame zählt nicht als erster", async (ctx) => {
    // Lauf 1 lebt länger als das Fenster (2 s) und stürzt ab, jeder weitere stürzt sofort ab: zwei schnelle Abstürze in Folge brauchen den 2. und 3. Lauf
    await install(ctx, "0.3.0", `log inst\nsleep-once ${ctx.dataDir}/slow 2300\nexit 3\n`);
    activate(ctx.dataDir, "0.3.0");
    const s = startStarter(env, env.starter, ctx);
    const r = await s.finish(30000);
    const runs = (s.log().match(/^inst$/gm) ?? []).length;
    check("langsam, dann schnell: drei Läufe der installierten Version, dann die eingebaute", r.code === 0 && runs === 3 && /builtin/.test(s.log()), `${r.code} Läufe ${runs}\n${s.log()}\n${r.stderr}`);
    check("langsam, dann schnell: Marker launcher-crash erst nach dem zweiten schnellen", readMarker(ctx.dataDir, "launcher-crash") === join(ctx.dataDir, "app", "versions", "0.3.0"), String(readMarker(ctx.dataDir, "launcher-crash")));
  });
  await scenario("force_builtin endet mit der 42 der eingebauten Version", async (ctx) => {
    await install(ctx, "0.3.0", `crash-times 2 ${ctx.dataDir}/count\nlog recovered\nexit 0\n`);
    activate(ctx.dataDir, "0.3.0");
    const s = startStarter(env, env.starter, ctx, { builtinScript: `exit-once ${ctx.dataDir}/bflag 42\nlog builtin-done\nexit 0\n` });
    const r = await s.finish();
    const order = s.log().split("\n").filter((l) => /^(recovered|builtin-done)$/.test(l)).join(",");
    check("force_builtin: nach der 42 der eingebauten Version entscheidet der Zeiger wieder", r.code === 0 && order === "recovered", `${r.code} ${order}\n${s.log()}\n${r.stderr}`);
  });

  // ───── 6b. Ein Launcher, der wiederholt sofort 42 meldet, bekommt Pausen (keine volle Prüfung ohne Atempause) ─────
  await scenario("wiederholte sofortige 42: Pausen, Signal bricht sie ab", async (ctx) => {
    await install(ctx, "0.3.0", "log inst\nexit 42\n");
    activate(ctx.dataDir, "0.3.0");
    const s = startStarter(env, env.starterBackoff, ctx);
    await sleep(3000);
    const runs = (s.log().match(/^inst$/gm) ?? []).length;
    const t0 = Date.now();
    s.child.kill("SIGTERM");
    const r = await s.finish(5000);
    check("sofortige 42: in 3 s nur eine Handvoll Läufe (4 frei, dann 0,2/0,4/0,8/1,6 s)", runs >= 4 && runs <= 9, `${runs} Läufe`);
    check("sofortige 42: SIGTERM beendet auch während der Pause schnell", r.code === 0 && Date.now() - t0 < 1500, `${r.code}/${r.signal} ${Date.now() - t0} ms`);
    check("sofortige 42: Pausenzeile im Log", /Pause von \d+ ms/.test(r.stderr), r.stderr.slice(-400));
  });

  // ───── 7. Exit-Codes der eingebauten Version ─────
  for (const code of [3, 78]) {
    await scenario(`eingebaut Exit ${code}`, async (ctx) => {
      const s = startStarter(env, env.starter, ctx, { builtinScript: `exit ${code}\n` });
      const r = await s.finish();
      check(`eingebauter Launcher Exit ${code} wird weitergegeben`, r.code === code, `${r.code}`);
    });
  }

  // ───── 8. Signale und geerbter Zustand ─────
  await scenario("geerbte Signalmaske", async (ctx) => {
    await install(ctx, "0.3.0", "status\nexit 0\n");
    activate(ctx.dataDir, "0.3.0");
    const s = startStarter(env, env.starter, ctx);
    await s.finish();
    const blk = /SigBlk:\s+(\w+)/.exec(s.log())?.[1];
    const cgt = /SigCgt:\s+(\w+)/.exec(s.log())?.[1];
    check("Launcher erbt keine Signalsperre und keine Handler des Starters", blk === "0000000000000000" && cgt === "0000000000000000", `${blk} ${cgt}`);
  });
  await scenario("SIGTERM erreicht den Launcher", async (ctx) => {
    await install(ctx, "0.3.0", "wait-term 0\n");
    activate(ctx.dataDir, "0.3.0");
    const s = startStarter(env, env.starter, ctx);
    check("SIGTERM: Launcher bereit", await s.waitFor(() => /ready/.test(s.log())), s.log());
    const t0 = Date.now();
    s.child.kill("SIGTERM");
    const r = await s.finish(5000);
    check("SIGTERM: Starter endet mit dem Code des Launchers, schnell", r.code === 0 && /term/.test(s.log()) && Date.now() - t0 < 2000, `${r.code}/${r.signal} ${Date.now() - t0} ms ${s.log()}`);
  });
  await scenario("SIGTERM zwischen zwei Läufen geht nicht verloren", async (ctx) => {
    // Der Launcher meldet 42 und der Starter prüft neu (die Prüfung ist groß genug, dass das Signal während der Prüfung eintrifft): danach darf kein Launcher mehr starten
    await install(ctx, "0.3.0", `exit-once ${ctx.dataDir}/flag 42\nlog second\nexit 0\n`, { sparse: { "gross.bin": 2 * 1024 ** 3 } });
    activate(ctx.dataDir, "0.3.0");
    const s = startStarter(env, env.starter, ctx);
    check("SIGTERM zwischen Läufen: erster Lauf beendet", await s.waitFor(() => existsSync(join(ctx.dataDir, "flag")), 30000));
    await sleep(300);
    const t0 = Date.now();
    s.child.kill("SIGTERM");
    const r = await s.finish(10000);
    check("SIGTERM zwischen Läufen: kein zweiter Lauf, schnell beendet, keine Marker", r.code === 0 && !/second/.test(s.log()) && Date.now() - t0 < 1500 && !readMarker(ctx.dataDir, "verify-failed") && !readMarker(ctx.dataDir, "inconclusive"), `${r.code}/${r.signal} ${Date.now() - t0} ms\n${s.log()}\n${r.stderr}`);
  });

  // ───── 9. Zeitüberschreitung und Abbruch der Prüfung ─────
  const big = { sparse: { "gross.bin": 3 * 1024 ** 3 } };
  await scenario("SIGTERM während der Prüfung", async (ctx) => {
    await install(ctx, "0.3.0", "log installed\nexit 0\n", big);
    activate(ctx.dataDir, "0.3.0");
    const s = startStarter(env, env.starter, ctx);
    check("SIGTERM in der Prüfung: Prüfung läuft", await s.waitFor(() => /Prüfe Version 0\.3\.0/.test(s.stderr()), 10000));
    await sleep(250);
    const t0 = Date.now();
    s.child.kill("SIGTERM");
    const r = await s.finish(10000);
    check("SIGTERM in der Prüfung: Exit in < 1 s, kein Launcher, keine Marker", Date.now() - t0 < 1000 && s.log() === "" && !readMarker(ctx.dataDir, "verify-failed") && !readMarker(ctx.dataDir, "inconclusive") && !readMarker(ctx.dataDir, "verify-ok"), `${Date.now() - t0} ms ${r.code}/${r.signal}\n${s.log()}\n${r.stderr}`);
  });
  await scenario("Zeitüberschreitung der Prüfung ist unklar, nicht negativ", async (ctx) => {
    await install(ctx, "0.3.0", "log installed\nexit 0\n", big);
    activate(ctx.dataDir, "0.3.0");
    const s = startStarter(env, env.starterShortTimeout, ctx);
    const r = await s.finish(30000);
    check("alarm: eingebaute Version, Marker inconclusive/timeout, kein verify-failed", r.code === 0 && /builtin/.test(s.log()) && readMarker(ctx.dataDir, "inconclusive") === "0.3.0\ntimeout\n" && !readMarker(ctx.dataDir, "verify-failed"), `${r.code} ${s.log()} ${readMarker(ctx.dataDir, "inconclusive")}\n${r.stderr}`);
  });
  await scenario("Prüfkind stirbt per Signal: unklar", async (ctx) => {
    await install(ctx, "0.3.0", "log installed\nexit 0\n", big);
    activate(ctx.dataDir, "0.3.0");
    const s = startStarter(env, env.starter, ctx);
    check("Prüfkind-SIGKILL: Prüfung läuft", await s.waitFor(() => /Prüfe Version 0\.3\.0/.test(s.stderr()), 10000));
    await sleep(250);
    const kids = run("pgrep", ["-P", String(s.child.pid)]).stdout.trim().split("\n").filter(Boolean);
    check("Prüfkind-SIGKILL: genau ein Kind (das Prüfkind)", kids.length === 1, kids.join(","));
    if (kids.length === 1) process.kill(Number(kids[0]), "SIGKILL");
    const r = await s.finish(30000);
    check("Prüfkind-SIGKILL: eingebaute Version, Marker inconclusive/signal", r.code === 0 && /builtin/.test(s.log()) && readMarker(ctx.dataDir, "inconclusive") === "0.3.0\nsignal\n" && !readMarker(ctx.dataDir, "verify-failed"), `${r.code} ${s.log()} ${readMarker(ctx.dataDir, "inconclusive")}\n${r.stderr}`);
  });

  await scenario("Ordner nach der Prüfung ausgetauscht: gestartet wird der geprüfte Ordner", async (ctx) => {
    // „Angreifer“ tauscht den Versionsordner, während geprüft wird (der Pfad zeigt danach auf eine fremde Version): der Starter ruft den Launcher aus dem Ordner auf, den der Prüfer durchlaufen hat
    const dir = await install(ctx, "0.3.0", "log installed\nexit 0\n", big);
    activate(ctx.dataDir, "0.3.0");
    const s = startStarter(env, env.starter, ctx);
    check("Tausch: Prüfung läuft", await s.waitFor(() => /Prüfe Version 0\.3\.0/.test(s.stderr()), 10000));
    await sleep(250);
    renameSync(dir, `${dir}.orig`);
    mkdirSync(join(dir, "runtime"), { recursive: true });
    copyFileSync(env.launcher, join(dir, "runtime", "node"));
    chmodSync(join(dir, "runtime", "node"), 0o755);
    writeFileSync(join(dir, "launcher.mjs"), "log EVIL\nexit 0\n");
    const r = await s.finish(30000);
    check("Tausch: der geprüfte Ordner läuft, der untergeschobene nie", r.code === 0 && /^installed$/m.test(s.log()) && !/EVIL/.test(s.log()) && /Version 0\.3\.0 geprüft/.test(r.stderr), `${r.code} ${s.log()}\n${r.stderr}`);
    check("Tausch: der Launcher lief im umbenannten (geprüften) Ordner", s.log().includes(`start ${dir}.orig/launcher.mjs`), s.log());
  });

  // ───── 10. Ruhezustand ─────
  await scenario("Überlebende werden vor der nächsten Prüfung beendet, Fremde nicht", async (ctx) => {
    const outsider = ctx.outsider();
    await install(ctx, "0.3.0", `daemon ${ctx.dataDir}/daemon.pid\nexit-once ${ctx.dataDir}/flag 42\ncheck-dead ${ctx.dataDir}/daemon.pid\nexit 0\n`);
    activate(ctx.dataDir, "0.3.0");
    const s = startStarter(env, env.starter, ctx);
    const r = await s.finish();
    check("Ruhezustand: der Überlebende des ersten Laufs ist beim zweiten tot", r.code === 0 && /^dead$/m.test(s.log()) && !/^alive$/m.test(s.log()), `${r.code}\n${s.log()}\n${r.stderr}`);
    let outsiderAlive = true;
    try {
      process.kill(outsider, 0);
    } catch {
      outsiderAlive = false;
    }
    check("Ruhezustand: ein fremder Prozess (wie docker exec) wird nicht berührt", outsiderAlive);
    // und der Überlebende ist nach dem Ende des Starters auch nicht mehr da (er wurde beendet, nicht nur eingesammelt)
    const pid = Number(readFileSync(join(ctx.dataDir, "daemon.pid"), "utf8"));
    let daemonGone = false;
    try {
      process.kill(pid, 0);
    } catch {
      daemonGone = true;
    }
    check("Ruhezustand: Daemon existiert nicht mehr", daemonGone, String(pid));
  });

  await scenario("Ruhezustand nicht erzwingbar: Marker quiesce, eingebaute Version, keine Prüfung", async (ctx) => {
    await install(ctx, "0.3.0", "log installed\nexit 0\n");
    activate(ctx.dataDir, "0.3.0");
    const s = startStarter(env, env.starterNoQuiesce, ctx);
    const r = await s.finish();
    check("quiesce: eingebaute Version, nicht geprüft, Marker inconclusive/quiesce, kein verify-failed", r.code === 0 && /builtin/.test(s.log()) && !/installed/.test(s.log()) && !/Prüfe Version/.test(r.stderr) && readMarker(ctx.dataDir, "inconclusive") === "0.3.0\nquiesce\n" && !readMarker(ctx.dataDir, "verify-failed"), `${r.code} ${s.log()} ${readMarker(ctx.dataDir, "inconclusive")}\n${r.stderr}`);
    check("quiesce: Warnzeile", /Ruhezustand nicht erzwingbar/.test(r.stderr), r.stderr);
  });

  // ───── 11. Schnittstellen ─────
  await scenario("--print-keys", async () => {
    const r = run(env.starter, ["--print-keys"]);
    const header = readFileSync(join(headerDir(FLOOR), "trust-keys.h"), "utf8");
    const keyBytes = (name) => Buffer.from([...new RegExp(`${name}\\[32\\] = \\{([^}]*)\\}`).exec(header)[1].matchAll(/0x([0-9a-f]{2})/g)].map((m) => parseInt(m[1], 16)));
    const fp = (b) => createHash("sha256").update(b).digest("hex").slice(0, 16);
    check("--print-keys: Fingerabdrücke = SHA-256 über die einkompilierten Schlüsselbytes", r.status === 0 && r.stdout === `root ${fp(keyBytes("SOS_ROOT_KEY"))}\nrelease ${fp(keyBytes("SOS_RELEASE_KEY"))}\n`, r.stdout);
  });
  await scenario("--verify bereinigt C1-, Bidi- und Zeilentrenner-Zeichen in Pfaden", async (ctx) => {
    const dir = await install(ctx, "0.3.0", "exit 0\n", { files: { "a.txt": "a" } });
    writeFileSync(join(dir, "x\u009b31;1mEVIL\u202eTXT\u2028y\u2066z\u200fq\u061cw"), "x");
    const r = run(env.starter, ["--verify", dir, "--expect-version", "0.3.0"], { env: { PATH: process.env.PATH, DATA_DIR: ctx.dataDir } });
    const json = JSON.parse(r.stdout.trim());
    check("--verify: Pfad ohne C1/Bidi/Zeilentrenner", r.status === 15 && json.path === "x?31;1mEVIL?TXT?y?z?q?w", `${r.status} ${r.stdout}`);
    check("--verify: auch die Textausgabe ist sauber", !/[\u0080-\u009f\u202a-\u202e\u2028\u2029\u2066-\u2069\u200e\u200f\u061c]/.test(r.stderr), JSON.stringify(r.stderr));
  });
  await scenario("--verify Aufruffehler", async (ctx) => {
    for (const args of [[], ["--bogus"], ["a", "b"], ["--expect-version"], ["--check-expiry", "2026-13-01", ctx.dataDir], ["--check-expiry", "x", ctx.dataDir], [ctx.dataDir, "--no-floor", "--no-floor"]]) {
      const r = run(env.starter, ["--verify", ...args]);
      check(`--verify ${JSON.stringify(args)}: Code 2`, r.status === 2 && /"code":2/.test(r.stdout), `${r.status} ${r.stdout}`);
    }
    const r = run(env.starter, ["--unbekannt"]);
    check("unbekanntes Argument: Code 2", r.status === 2);
  });
  await scenario("--healthcheck", async () => {
    check("healthcheck ohne Server: 1", run(env.starter, ["--healthcheck"], { env: { PORT: "1" } }).status === 1);
    for (const [status, expected] of [[200, 0], [503, 1]]) {
      const server = createServer((req, res) => {
        res.statusCode = status;
        res.end("{}");
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = server.address().port;
      const r = await new Promise((resolve) => {
        const p = spawn(env.starter, ["--healthcheck"], { env: { PORT: String(port) } });
        p.on("close", resolve);
      });
      server.close();
      check(`healthcheck HTTP ${status}: Exit ${expected}`, r === expected, String(r));
    }
  });

  log(`${count} Prüfungen in den Szenarien; Starter-Binary: ${env.starter.split("/").pop()}`);
  if (failures.length) log(failures.slice(0, 40).map((f) => `  ${f}`).join("\n"));
  return failures.length === 0;
}

