import { z } from "zod";
import { claimRow } from "@/lib/concurrency";
import { MAX_TARGETS, MONITOR_KINDS, MONITOR_METHODS } from "@/lib/monitor/model";
import { normalizeTarget, targetKey } from "@/lib/monitor/target";
import { loginThrottle } from "@/server/auth/throttle";
import { defineOperation, fail, failField } from "@/server/operations";
import { isForbiddenTargetHost } from "@/server/host-gateway";
import { MONITOR_ENABLED_SETTING } from "@/server/monitor/run";
import { setSetting } from "@/server/settings";

/**
 * Operationen der Netzwerk-Überwachung (F12). Alle verlangen das **eigene Recht `network.monitor`** (nicht schon `network.edit`): Ein Überwachungsziel lässt den Server Verbindungen ins eigene Netz
 * aufbauen – wer es anlegt, kann prüfen lassen, welche Adressen und Ports erreichbar sind. Deshalb: das Recht ist gekennzeichnet (nie in Standardrollen, nie in einem API-Token), höchstens 100 Ziele,
 * Mindestintervall 60 s, jede Änderung im Audit-Log (mit Ziel, nie mit Zugangsdaten – es gibt keine), und beim Prüfen gilt die Zielsperre noch einmal (`server/monitor/resolve.ts`).
 *
 * **Grenzen des Rechts** (Hilfe „Netzwerk“): Wer es hat, kann den Server interne Adressen und Ports abfragen lassen – zurück kommen nur Erreichbarkeit, Statusklasse und Antwortzeit, aber das genügt, um ein Netz
 * abzutasten. Deshalb: der Docker-Host (Host-Gateway des Containers, `host.docker.internal`) ist gesperrt wie der eigene Rechner; **neue oder geänderte Zieladressen** (Host, Port, Pfad, Art) sind je Konto
 * gedrosselt (`loginThrottle.monitorChanges`: 10 frei, danach wachsende Wartezeit); Umbenennen, Intervall und Ein-/Ausschalten zählen nicht. Das Recht setzt `network.view` voraus (die Formulare lesen Geräte
 * und IP-Adressen der IP-Verwaltung).
 */
const needView = (principal: { can(permission: "network.view"): boolean }) => {
  if (!principal.can("network.view")) fail("forbidden");
};

const flag = z.preprocess((v) => v === true || v === "1" || v === "on" || v === "true", z.boolean());

/** Zustand eines Ziels, das (noch) nicht gemessen ist */
const FRESH_STATE = { state: "unknown", stateSince: null, failStreak: 0, lastCheckAt: null, lastLatencyMs: null, lastClass: null } as const;

const targetInput = z.object({
  id: z.string().optional(),
  version: z.string().optional(),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(MONITOR_KINDS),
  host: z.string().trim().min(1).max(300),
  port: z.coerce.number().int().optional(),
  path: z.string().max(300).optional(),
  method: z.enum(MONITOR_METHODS).default("HEAD"),
  ignoreTlsErrors: flag.default(false),
  intervalSec: z.coerce.number().int(),
  enabled: flag.default(true),
  deviceId: z.string().optional(),
});

export const saveMonitorTargetOperation = defineOperation({
  name: "network.saveMonitorTarget",
  permission: "network.monitor",
  input: targetInput,
  audit: (input) => (input.id ? "network.monitorUpdate" : "network.monitorCreate"),
  run: async ({ input, principal, tx, audit }) => {
    needView(principal);
    const normalized = normalizeTarget({ kind: input.kind, host: input.host, port: input.port, path: input.path, method: input.method, intervalSec: input.intervalSec });
    if (!normalized.ok) failField(normalized.problem.field, `network.monitor.errors.${normalized.problem.key}`);
    const n = normalized.value;
    // Der Docker-Host ist „der eigene Rechner“ (im Container: Host-Gateway; Namen wie host.docker.internal sperrt normalizeTarget)
    if (isForbiddenTargetHost(n.host)) failField("host", "network.monitor.errors.forbiddenHost");
    if (input.deviceId && !(await tx.netDevice.findUnique({ where: { id: input.deviceId }, select: { id: true } }))) failField("deviceId", "validation.invalid");

    // Doppelte Ziele (gleiche Art, Host, Port, Pfad) bringen nichts außer doppelter Last
    const existing = await tx.netMonitorTarget.findMany({ select: { id: true, kind: true, host: true, port: true, path: true, method: true, ignoreTlsErrors: true, intervalSec: true, lastCheckAt: true, enabled: true } });
    const key = targetKey(n);
    if (existing.some((t) => t.id !== input.id && targetKey(t) === key)) failField("host", "network.monitor.errors.duplicate");
    if (!input.id && existing.length >= MAX_TARGETS) fail("conflict", "network.monitor.errors.limit", { max: MAX_TARGETS });
    // Drosselung neuer und umadressierter Ziele: das Recht darf kein schneller Port-Scanner werden
    const known = existing.find((t) => t.id === input.id);
    if (!known || known.kind !== n.kind || known.host !== n.host || known.port !== n.port || known.path !== n.path) {
      const wait = loginThrottle.monitorChanges.check(principal.user.id);
      if (wait > 0) fail("forbidden", "network.monitor.errors.tooManyChanges", { minutes: Math.max(1, Math.ceil(wait / 60_000)) });
      loginThrottle.monitorChanges.take(principal.user.id);
    }

    const data = {
      name: input.name,
      kind: n.kind,
      host: n.host,
      port: n.port,
      path: n.path,
      method: n.method,
      ignoreTlsErrors: n.kind === "https" ? input.ignoreTlsErrors : false,
      intervalSec: n.intervalSec,
      enabled: input.enabled,
      deviceId: input.deviceId ?? null,
    };
    let id = input.id;
    if (id) {
      const before = existing.find((t) => t.id === id);
      if (!before) fail("notFound");
      if (!(await claimRow(tx.netMonitorTarget, id, input.version))) fail("conflict");
      // Ändert sich, WAS geprüft wird, gilt der bisherige Zustand nicht mehr: neu messen (der Verlauf bleibt beim Ziel, bis er ausläuft)
      const retargeted = before.kind !== n.kind || before.host !== n.host || before.port !== n.port || before.path !== n.path || before.method !== n.method || before.ignoreTlsErrors !== data.ignoreTlsErrors;
      // Wird ein Ziel ausgeschaltet, gilt sein Zustand nicht mehr (nichts wird gemessen): wie beim Umadressieren neu anfangen – sonst stünde nach dem Wiedereinschalten „Wieder erreichbar nach 3 Tagen“
      const switchedOff = before.enabled && !input.enabled;
      const now = new Date();
      // Ändert sich das Intervall, rückt der nächste Termin mit: letzte Messung + neues Intervall (überfällig = jetzt). Sonst bliebe ein auf 1 Minute verkürztes Ziel bis zu eine Stunde „veraltet“ und ein verlängertes
      // würde zu früh geprüft.
      const rescheduled = before.intervalSec !== n.intervalSec && before.lastCheckAt ? new Date(Math.max(now.getTime(), before.lastCheckAt.getTime() + n.intervalSec * 1000)) : before.intervalSec !== n.intervalSec ? now : null;
      await tx.netMonitorTarget.update({
        where: { id },
        data: { ...data, ...(retargeted || switchedOff ? { ...FRESH_STATE, nextCheckAt: now } : rescheduled ? { nextCheckAt: rescheduled } : {}) },
      });
    } else {
      id = (await tx.netMonitorTarget.create({ data: { ...data, createdByName: principal.user.name }, select: { id: true } })).id;
    }
    audit({ target: `${input.name}: ${n.kind}://${n.host}:${n.port}`, entityId: id });
    return { id };
  },
});

export const deleteMonitorTargetOperation = defineOperation({
  name: "network.deleteMonitorTarget",
  permission: "network.monitor",
  input: z.object({ id: z.string().min(1) }),
  audit: "network.monitorDelete",
  run: async ({ input, principal, tx, audit }) => {
    needView(principal);
    const target = await tx.netMonitorTarget.findUnique({ where: { id: input.id }, select: { name: true, kind: true, host: true, port: true } });
    if (!target) fail("notFound");
    // Der Verlauf (Messwerte, Zustandswechsel) wird mit gelöscht – die Oberfläche kündigt es an; das Audit-Log hält das Ziel fest
    await tx.netMonitorTarget.delete({ where: { id: input.id } });
    audit({ target: `${target.name}: ${target.kind}://${target.host}:${target.port}`, entityId: input.id });
    return { id: input.id };
  },
});

/** Schalter „Überwachung“: aus (Standard) = es wird nichts geprüft, alle Status bleiben „unbekannt“. */
export const setMonitoringOperation = defineOperation({
  name: "network.setMonitoring",
  permission: "network.monitor",
  input: z.object({ enabled: flag }),
  audit: "network.monitorSwitch",
  run: async ({ input, principal, tx, audit }) => {
    needView(principal);
    await setSetting(MONITOR_ENABLED_SETTING, input.enabled ? "true" : "false", tx);
    // Beim Einschalten sind alle Ziele sofort fällig, damit nicht noch Stunden alte Messungen als Status stehen
    if (input.enabled) await tx.netMonitorTarget.updateMany({ where: { nextCheckAt: { gt: new Date() } }, data: { nextCheckAt: new Date() } });
    // Beim Ausschalten ist jeder Zustand unbekannt (Hilfe: „bei ausgeschalteter Überwachung ist jeder Zustand unbekannt“); die Ausfalldauer zählt keine Zeit ohne Überwachung mit
    else await tx.netMonitorTarget.updateMany({ data: FRESH_STATE });
    audit({ target: input.enabled ? "ein" : "aus" });
    return { enabled: input.enabled };
  },
});
