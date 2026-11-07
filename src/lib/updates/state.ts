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
  last: { at: string; version: string; status: "ok" | "rolled-back"; reason?: string } | null;
};

export const emptyState = (): UpdateState => ({ schema: STATE_SCHEMA, current: null, previous: null, pending: false, failed: [], last: null });

/** Liest eine unbekannte JSON-Struktur defensiv in einen gültigen Zustand (kaputte Datei → leerer Zustand). */
export function parseState(raw: unknown): UpdateState {
  if (!raw || typeof raw !== "object") return emptyState();
  const r = raw as Record<string, unknown>;
  if (r.schema !== STATE_SCHEMA) return emptyState();
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const last = r.last as Record<string, unknown> | null | undefined;
  return {
    schema: STATE_SCHEMA,
    current: str(r.current),
    previous: str(r.previous),
    pending: r.pending === true,
    failed: Array.isArray(r.failed) ? r.failed.filter((v): v is string => typeof v === "string") : [],
    last:
      last && typeof last === "object" && typeof last.at === "string" && typeof last.version === "string" && (last.status === "ok" || last.status === "rolled-back")
        ? { at: last.at, version: last.version, status: last.status, ...(typeof last.reason === "string" ? { reason: last.reason } : {}) }
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
export function afterFailure(state: UpdateState, reason: string, now: string): UpdateState {
  const broken = state.current;
  return {
    ...state,
    current: state.previous,
    previous: null,
    pending: false,
    failed: broken && !state.failed.includes(broken) ? [...state.failed, broken] : state.failed,
    last: broken ? { at: now, version: broken, status: "rolled-back", reason } : state.last,
  };
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
