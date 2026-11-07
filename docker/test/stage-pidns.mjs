// Stufe „pidns“: der Starter als PID 1 in einem eigenen PID-Namensraum (unshare -rpf --mount-proc, ohne Root-Rechte und ohne Docker) – wie im Container.
// Geprüft wird, was nur als PID 1 gilt: Der Launcher hat ppid 1, Überlebende des vorigen Laufs werden beendet und eingesammelt, SIGTERM von außen erreicht Launcher und
// Prüfkind (Handler von PID 1), eine laufende Prüfung bricht in < 1 s ab. Ohne unterstützte Namensräume: Hinweis (CI mit REQUIRE_NATIVE=1: Fehler).
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { activate, makePackage, removeTree, run, tempDir } from "./lib.mjs";
import { starterEnv, startStarter } from "./stage-starter.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const WRAP = ["unshare", "-rpf", "--mount-proc"];

export async function pidnsStage(log) {
  const probe = run("unshare", ["-rpf", "--mount-proc", "sh", "-c", 'test "$$" = 1']);
  if (probe.status !== 0) {
    log(`PID-Namensräume ohne Root nicht verfügbar (${probe.error?.code ?? probe.stderr.trim()}) – Stufe übersprungen.`);
    return process.env.REQUIRE_NATIVE !== "1";
  }
  const env = starterEnv();
  const failures = [];
  const check = (name, ok, detail = "") => {
    if (!ok) failures.push(`${name}${detail ? ": " + detail : ""}`);
  };
  const scenario = async (name, fn) => {
    const dataDir = tempDir("so-pidns-");
    mkdirSync(join(dataDir, "app", "versions"), { recursive: true });
    try {
      await fn({ dataDir });
    } catch (error) {
      failures.push(`${name}: Ausnahme ${error.stack ?? error}`);
    } finally {
      removeTree(dataDir);
    }
  };
  const install = (ctx, version, script, options = {}) => makePackage(ctx.dataDir, version, { launcherBinary: env.launcher, script, ...options });

  await scenario("pid1", async (ctx) => {
    await install(ctx, "0.3.0", "ppid\nexit 0\n");
    activate(ctx.dataDir, "0.3.0");
    const s = startStarter(env, env.starter, ctx, { wrap: WRAP });
    const r = await s.finish();
    check("PID 1: der Launcher hat ppid 1", r.code === 0 && /^ppid 1$/m.test(s.log()), `${r.code}\n${s.log()}\n${r.stderr}`);
  });

  await scenario("überlebende", async (ctx) => {
    await install(ctx, "0.3.0", `daemon ${ctx.dataDir}/daemon.pid\nexit-once ${ctx.dataDir}/flag 42\ncheck-dead ${ctx.dataDir}/daemon.pid\nexit 0\n`);
    activate(ctx.dataDir, "0.3.0");
    const s = startStarter(env, env.starter, ctx, { wrap: WRAP });
    const r = await s.finish();
    check("PID 1: der Überlebende ist beim zweiten Lauf tot", r.code === 0 && /^dead$/m.test(s.log()) && !/^alive$/m.test(s.log()), `${r.code}\n${s.log()}\n${r.stderr}`);
  });

  await scenario("sigterm", async (ctx) => {
    await install(ctx, "0.3.0", "wait-term 0\n");
    activate(ctx.dataDir, "0.3.0");
    const s = startStarter(env, env.starter, ctx, { wrap: WRAP });
    check("PID 1 SIGTERM: Launcher bereit", await s.waitFor(() => /ready/.test(s.log())), s.log());
    const initPid = run("pgrep", ["-P", String(s.child.pid)]).stdout.trim().split("\n")[0];
    check("PID 1 SIGTERM: PID 1 des Namensraums gefunden", !!initPid);
    const t0 = Date.now();
    if (initPid) process.kill(Number(initPid), "SIGTERM"); // von außerhalb des Namensraums: PID 1 bekommt nur Signale, für die es einen Handler hat
    const r = await s.finish(10000);
    check("PID 1 SIGTERM: Launcher beendet, Starter endet mit 0 in < 2 s", r.code === 0 && /term/.test(s.log()) && Date.now() - t0 < 2000, `${r.code}/${r.signal} ${Date.now() - t0} ms ${s.log()}`);
  });

  await scenario("sigterm in der Prüfung", async (ctx) => {
    await install(ctx, "0.3.0", "log installed\nexit 0\n", { sparse: { "gross.bin": 3 * 1024 ** 3 } });
    activate(ctx.dataDir, "0.3.0");
    const s = startStarter(env, env.starter, ctx, { wrap: WRAP });
    check("PID 1 Prüfung: läuft", await s.waitFor(() => /Prüfe Version 0\.3\.0/.test(s.stderr()), 10000));
    await sleep(300);
    const initPid = run("pgrep", ["-P", String(s.child.pid)]).stdout.trim().split("\n")[0];
    const t0 = Date.now();
    if (initPid) process.kill(Number(initPid), "SIGTERM");
    const r = await s.finish(10000);
    check("PID 1 Prüfung: SIGTERM beendet die Prüfung in < 1 s, kein Launcher", Date.now() - t0 < 1000 && s.log() === "" && !existsSync(join(ctx.dataDir, "app", "verify-failed")) && !existsSync(join(ctx.dataDir, "app", "inconclusive")), `${Date.now() - t0} ms ${r.code}/${r.signal}\n${s.log()}\n${r.stderr}`);
  });

  log(`${failures.length ? failures.length + " Abweichung(en)" : "alle Prüfungen bestanden"} (unshare -rpf --mount-proc, Starter als PID 1)`);
  if (failures.length) log(failures.map((f) => `  ${f}`).join("\n"));
  void readFileSync;
  return failures.length === 0;
}
