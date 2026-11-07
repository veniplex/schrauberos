/**
 * Zustand des Update-Mechanismus (Datei `<DATA_DIR>/app/state.json`) – gemeinsam genutzt von der App (schreibt beim
 * Installieren) und vom Launcher (liest beim Start, schreibt bei Bestätigung/Rückfall). Reine Funktionen, kein I/O.
 * Ändert sich das Format, muss `STATE_SCHEMA` und die Basis-Version des Images (docker/BASE_VERSION) erhöht werden.
 */

export const STATE_SCHEMA = 1;
/** Exit-Code, mit dem die App dem Launcher einen Neustart (z. B. nach einem Update) meldet. */
export const RESTART_EXIT_CODE = 42;

/** Beschreibt, was in einem App-Verzeichnis (eingebaut oder installiert) steckt: version.json. */
export type VersionMeta = {
  version: string;
  /**
   * Version des Starter-Vertrags (docker/bootstrap.c, siehe docker/BASE_VERSION). Ein Paket läuft nur auf einem Image mit
   * gleichem Vertrag – es bringt alles andere selbst mit (Node, Systembibliotheken, Launcher, Anwendung).
   */
  base: number;
  /** Node-Version, mit der diese App-Version gebaut wurde und die im Paket liegt (zur Anzeige) */
  node?: string;
  /** CPU-Architektur, für die das Paket gebaut wurde (process.arch) */
  arch?: string;
  /** Git-Commit, aus dem das Paket gebaut wurde (Kurzform, nur zur Anzeige im Systemstatus; fehlt bei lokalen Builds) */
  commit?: string;
};

export type UpdateState = {
  schema: typeof STATE_SCHEMA;
  /** Aus dem Volume installierte Version; null = die im Image eingebaute Version */
  current: string | null;
  /** Rückfallebene für den Fall, dass `current` nicht startet; null = eingebaute Version */
  previous: string | null;
  /** Die neue Version ist gestartet worden, aber noch nicht als gesund bestätigt */
  pending: boolean;
  /** Versionen, die nicht gestartet werden konnten – der Launcher überspringt sie */
  failed: string[];
  /**
   * Ergebnis des letzten Versuchs. `reason` ist ein Kurztext oder ein Code der Form `integrity:<Prüfcode>` (Integritätsprüfung des Starters fehlgeschlagen);
   * `detail` ist dann der – von Steuerzeichen befreite, gekürzte – Pfad der Abweichung (nur Anzeige).
   */
  last: { at: string; version: string; status: "ok" | "rolled-back"; reason?: string; detail?: string } | null;
  /**
   * Die Prüfung dieser Version durch den Starter ist unklar geblieben (Signal, Zeitüberschreitung, Ein-/Ausgabefehler) oder hat gar nicht stattgefunden (`quiesce`): kein Befund über
   * den Inhalt. Die Version bleibt `current`; der nächste Start prüft erneut. Nur `signal` und `io` zählen als Fehlversuch (`count`); nach `INCONCLUSIVE_LIMIT` davon wird die Version
   * wie ein negativer Befund behandelt. `count` kann 0 sein (nur nicht zählende Läufe: Zeitüberschreitung, Ruhezustand, …).
   */
  inconclusive: { version: string; count: number; at: string; reason: string } | null;
};

/** So viele zählende unklare Prüfungen derselben Version, bis sie wie ein negativer Befund behandelt wird. */
export const INCONCLUSIVE_LIMIT = 3;

/**
 * Welche unklaren Prüfungen zählen? Nur solche, die auf einen Defekt des Datenträgers oder des Prüfprozesses hindeuten (Signal, Ein-/Ausgabefehler). Eine Zeitüberschreitung (großes
 * Paket auf langsamem Datenträger), ein nicht herstellbarer Ruhezustand oder ein nicht startbarer Prüfprozess sagen nichts über die Version – sie brennen sie nie ein, die eingebaute
 * Version läuft einfach weiter.
 */
export const countsAsAttempt = (reason: string): boolean => reason === "signal" || reason === "io";

export const emptyState = (): UpdateState => ({ schema: STATE_SCHEMA, current: null, previous: null, pending: false, failed: [], last: null, inconclusive: null });

/** Liest eine unbekannte JSON-Struktur defensiv in einen gültigen Zustand (kaputte Datei → leerer Zustand). */
export function parseState(raw: unknown): UpdateState {
  if (!raw || typeof raw !== "object") return emptyState();
  const r = raw as Record<string, unknown>;
  if (r.schema !== STATE_SCHEMA) return emptyState();
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const last = r.last as Record<string, unknown> | null | undefined;
  const unclear = r.inconclusive as Record<string, unknown> | null | undefined;
  return {
    schema: STATE_SCHEMA,
    current: str(r.current),
    previous: str(r.previous),
    pending: r.pending === true,
    failed: Array.isArray(r.failed) ? r.failed.filter((v): v is string => typeof v === "string") : [],
    last:
      last && typeof last === "object" && typeof last.at === "string" && typeof last.version === "string" && (last.status === "ok" || last.status === "rolled-back")
        ? { at: last.at, version: last.version, status: last.status, ...(typeof last.reason === "string" ? { reason: last.reason } : {}), ...(typeof last.detail === "string" ? { detail: last.detail.slice(0, 200) } : {}) }
        : null,
    inconclusive:
      unclear && typeof unclear === "object" && typeof unclear.version === "string" && typeof unclear.at === "string" && typeof unclear.reason === "string" && Number.isInteger(unclear.count) && (unclear.count as number) >= 0
        ? { version: unclear.version, count: unclear.count as number, at: unclear.at, reason: unclear.reason.slice(0, 40) }
        : null,
  };
}

/** Kann der Code dieses Verzeichnisses mit der Umgebung des laufenden Images starten? */
export const isCompatible = (meta: VersionMeta, image: VersionMeta) => meta.base === image.base && (!meta.arch || !image.arch || meta.arch === image.arch);

/** Zustand nach dem Installieren einer neuen Version (die der Launcher beim Neustart startet). */
export function afterInstall(state: UpdateState, version: string): UpdateState {
  return { ...state, current: version, previous: state.current, pending: true, failed: state.failed.filter((v) => v !== version) };
}

/** Die neue Version ist gestartet und antwortet gesund. */
export function afterHealthy(state: UpdateState, version: string, now: string): UpdateState {
  return { ...state, pending: false, last: { at: now, version, status: "ok" } };
}

/** Die neue Version startete nicht: zurück auf die Vorversion und die fehlerhafte merken. */
export function afterFailure(state: UpdateState, reason: string, now: string, detail?: string): UpdateState {
  const broken = state.current;
  return {
    ...state,
    current: state.previous,
    previous: null,
    pending: false,
    failed: broken && !state.failed.includes(broken) ? [...state.failed, broken] : state.failed,
    last: broken ? { at: now, version: broken, status: "rolled-back", reason, ...(detail ? { detail } : {}) } : state.last,
    inconclusive: state.inconclusive?.version === broken ? null : state.inconclusive,
  };
}

/**
 * Der Starter hat `version` (nach einem Integritätsbefund) abgelehnt – egal ob sie die aktuelle, die Vorversion oder eine andere war: Sie wird gesperrt. Ist es die
 * aktuelle, gilt die Vorversion (soweit vorhanden) – dann prüft der Starter beim nächsten Start diese (Vorversion zuerst, erst danach die eingebaute Version).
 * `reason` ist `integrity:<Code>`.
 */
export function afterIntegrityFailure(state: UpdateState, version: string, reason: string, now: string, detail?: string): UpdateState {
  const failed = state.failed.includes(version) ? state.failed : [...state.failed, version];
  const last = { at: now, version, status: "rolled-back" as const, reason, ...(detail ? { detail } : {}) };
  if (state.current === version) return { ...afterFailure(state, reason, now, detail), failed, last };
  return { ...state, previous: state.previous === version ? null : state.previous, failed, last, pending: false, inconclusive: state.inconclusive?.version === version ? null : state.inconclusive };
}

/** Eine unklare Prüfung von `version`: festhalten (die Version bleibt eingetragen); nur zählende Gründe erhöhen den Zähler. */
export function afterInconclusive(state: UpdateState, version: string, reason: string, now: string): UpdateState {
  const previous = state.inconclusive?.version === version ? state.inconclusive.count : 0;
  const count = countsAsAttempt(reason) ? previous + 1 : previous;
  return { ...state, inconclusive: { version, count, at: now, reason: reason.slice(0, 40) } };
}

export type StartChoice = { kind: "builtin" } | { kind: "volume"; version: string };

/**
 * Welche Version soll der Launcher starten?
 * Die installierte Version gilt nur, wenn sie vorhanden, zum Image kompatibel, nicht als fehlerhaft markiert und
 * neuer als die eingebaute ist (ein neu gezogenes Image löst ein älteres Volume-Update ab).
 */
export function chooseStart(
  state: UpdateState,
  image: VersionMeta,
  installed: (version: string) => VersionMeta | null,
  compare: (a: string, b: string) => number,
): StartChoice {
  const v = state.current;
  if (!v || state.failed.includes(v)) return { kind: "builtin" };
  const meta = installed(v);
  if (!meta || meta.version !== v || !isCompatible(meta, image) || compare(meta.version, image.version) <= 0) return { kind: "builtin" };
  return { kind: "volume", version: v };
}

/** Versionen, die nach einer Auswahl noch gebraucht werden (alles andere im Volume darf gelöscht werden). */
export const versionsToKeep = (state: UpdateState): string[] => [state.current, state.previous].filter((v): v is string => !!v);
