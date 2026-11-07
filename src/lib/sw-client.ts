/**
 * Browser-Seite des Service Workers (`public/sw.js`, P3-5): registrieren, auf ein Update hinweisen, beim Abmelden die Zwischenspeicher leeren.
 * Reine Funktionen über schmale Schnittstellen (`ServiceWorkerContainerLike`) – getestet in `sw-client.test.ts` ohne Browser.
 *
 * Registriert wird **nur im Betrieb und nur in einem sicheren Kontext** (HTTPS oder `localhost`; ein Service Worker ist sonst gar nicht möglich). In der Entwicklung nie: Dort sind die
 * Dateinamen unter `_next/static` nicht gehasht, ein Zwischenspeicher würde veralteten Code liefern.
 */

/** Adresse des Service Workers; `v` ist die Kennung des laufenden Codes (`server/app-version.ts`) und damit Teil des Namens der Zwischenspeicher. */
export const swUrl = (version: string) => `/sw.js?v=${encodeURIComponent(version)}`;

/** Präfix der Zwischenspeicher dieser App (muss zu `public/sw.js` passen: `sw.test.ts`). */
export const CACHE_PREFIX = "sos-";

export type ServiceWorkerLike = { state?: string; postMessage(message: unknown): void; addEventListener(type: "statechange", listener: () => void): void };
export type RegistrationLike = {
  waiting: ServiceWorkerLike | null;
  installing: ServiceWorkerLike | null;
  addEventListener(type: "updatefound", listener: () => void): void;
};
export type ServiceWorkerContainerLike = {
  controller: { postMessage(message: unknown): void } | null;
  register(url: string, options?: { scope?: string; updateViaCache?: "none" }): Promise<RegistrationLike>;
  ready: Promise<{ active: { postMessage(message: unknown): void } | null }>;
  addEventListener(type: "controllerchange", listener: () => void): void;
};

export type Environment = { production: boolean; isSecureContext: boolean; container: ServiceWorkerContainerLike | undefined };

export const canRegister = (env: Environment): env is Environment & { container: ServiceWorkerContainerLike } => env.production && env.isSecureContext && env.container !== undefined;

/**
 * Registriert den Service Worker und meldet über `onUpdate`, wenn eine **neue Version bereitsteht** (ein wartender Service Worker, während die Seite schon von einem gesteuert wird;
 * beim allerersten Installieren gibt es nichts zu melden). Sichert außerdem die Offline-Seite (`WARM`), sobald ein Service Worker aktiv ist. Fehler (Browser verweigert, Server
 * startet gerade) bleiben still: Ohne Service Worker funktioniert die Anwendung wie bisher.
 */
export async function registerServiceWorker(options: { version: string; env: Environment; onUpdate: (worker: ServiceWorkerLike) => void }): Promise<boolean> {
  const { env } = options;
  if (!canRegister(env)) return false;
  const container = env.container;
  try {
    const registration = await container.register(swUrl(options.version), { scope: "/", updateViaCache: "none" });
    const announce = (worker: ServiceWorkerLike) => {
      if (container.controller) options.onUpdate(worker);
    };
    if (registration.waiting) announce(registration.waiting);
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed") announce(worker);
      });
    });
    void container.ready.then((ready) => ready.active?.postMessage({ type: "WARM" })).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/** „Neu laden“: den wartenden Service Worker aktivieren; sobald er die Seite übernimmt, lädt `reload` sie neu (einmal). */
export function activateUpdate(worker: ServiceWorkerLike, container: Pick<ServiceWorkerContainerLike, "addEventListener">, reload: () => void) {
  let done = false;
  container.addEventListener("controllerchange", () => {
    if (done) return;
    done = true;
    reload();
  });
  worker.postMessage({ type: "SKIP_WAITING" });
}

/**
 * Beim Abmelden: alle Zwischenspeicher leeren. Der Service Worker bekommt `CLEAR` (er löscht jede Version); zusätzlich löscht die Seite die Zwischenspeicher selbst, falls sie
 * gerade von keinem Service Worker gesteuert wird. Nichts davon enthält Sitzungs- oder Fachdaten (nur die Offline-Seite und Programmdateien) – es ist Sauberkeit, kein Schutz.
 * Die Offline-Seite wird beim nächsten Seitenaufruf wieder gesichert (`WARM`).
 */
export function clearOfflineCaches(env: { container: Pick<ServiceWorkerContainerLike, "controller"> | undefined; caches: { keys(): Promise<string[]>; delete(name: string): Promise<boolean> } | undefined }): Promise<void> {
  env.container?.controller?.postMessage({ type: "CLEAR" });
  const { caches } = env;
  if (!caches) return Promise.resolve();
  return caches
    .keys()
    .then((names) => Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX)).map((name) => caches.delete(name))))
    .then(() => undefined)
    .catch(() => undefined);
}

/** Für den Aufruf im Browser (Abmelden): echte Umgebung einsetzen. */
export function clearOfflineCachesInBrowser(): Promise<void> {
  if (typeof navigator === "undefined") return Promise.resolve();
  return clearOfflineCaches({ container: "serviceWorker" in navigator ? navigator.serviceWorker : undefined, caches: typeof caches === "undefined" ? undefined : caches });
}
