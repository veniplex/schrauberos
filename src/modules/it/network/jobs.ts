import { hasDueTargets, pruneMonitor, runDueChecks } from "@/server/monitor/run";
import type { JobDef } from "@/server/jobs/types";

/**
 * Netzwerk-Überwachung (F12) über den Job-Runner – kein eigener Zeitgeber:
 *  - **`network.monitor`** (alle 30 s, billige Vorabprüfung): prüft die fälligen Ziele, nur wenn die Überwachung eingeschaltet ist (Standard: aus). Der Runner belegt den Job in der Datenbank (kein
 *    Doppellauf), jedes Ziel zusätzlich einzeln; höchstens 4 Prüfungen gleichzeitig, 5 s je Prüfung, 45 s je Lauf, das am längsten wartende Ziel zuerst. Ein Ziel, das ausfällt, ist **kein** Fehler
 *    des Jobs (es ist das Messergebnis); ein Fehler außerhalb der Prüfung (Datenbank …) lässt den Lauf scheitern – der Runner wiederholt, der Systemstatus zeigt es.
 *  - **`network.monitor-prune`** (nachts): Rohwerte älter als 7 Tage zu Stundenwerten verdichten, Stundenwerte nach 30 Tagen, Zustandswechsel nach 90 Tagen löschen.
 * Beide laufen nur, solange die Funktion „IT & Netzwerk“ aktiv ist.
 */
export const jobs: JobDef[] = [
  {
    id: "network.monitor",
    feature: "it.network",
    schedule: { every: 30_000 },
    retry: { baseDelayMs: 30_000, maxDelayMs: 5 * 60_000 },
    timeoutMs: 2 * 60_000,
    shouldRun: ({ now }) => hasDueTargets(now),
    run: async ({ signal }) => {
      // Ohne `now` des Läufers: jede Prüfung nimmt die aktuelle Zeit
      const s = await runDueChecks({ signal });
      if (s.errors > 0) throw new Error("network_monitor_failed");
      // Nur Auffälliges festhalten (wie alle Jobs): eine Routinerunde schreibt keinen Eintrag ins Laufprotokoll – es würde sonst alle 30 s einen füllen und die Fehler anderer Jobs aus „letzte Läufe“ drängen.
      // Auffällig sind Zustandswechsel (Ausfall, Wiederkehr); den Dauerzustand zeigen Überwachung und Systemstatus.
      if (s.wentDown === 0 && s.cameBack === 0) return undefined;
      return [s.wentDown ? `${s.wentDown} ausgefallen` : null, s.cameBack ? `${s.cameBack} wieder erreichbar` : null].filter(Boolean).join(", ");
    },
  },
  {
    id: "network.monitor-prune",
    feature: "it.network",
    schedule: { cron: "20 3 * * *" },
    run: async ({ now }) => {
      const removed = await pruneMonitor(now);
      return removed > 0 ? `${removed} aufgeräumt` : undefined;
    },
  },
];
