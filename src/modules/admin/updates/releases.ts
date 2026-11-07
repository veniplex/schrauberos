import "server-only";
import { FetchPolicyError, fetchWithPolicy } from "@/lib/updates/safe-fetch";
import { fetchPolicy, updateConfig } from "./config";
import { parseEndorsements, trustedReleaseKeys, validEndorsements } from "@/lib/updates/keychain";
import { readEndorsements, readNotesCopy, writeEndorsements, writeNotesCopy } from "@/lib/updates/store";
import { pemToRawKey } from "@/lib/updates/keychain";
import { SEAL_MAX_BYTES, verifySeal } from "@/lib/updates/seal";
import { UpdateError, verifyManifest, type Manifest } from "./manifest";

type GithubAsset = { name: string; url: string; size: number };
type GithubRelease = { tag_name: string; body: string | null; published_at: string | null; assets: GithubAsset[] };

export type Release = {
  version: string;
  notes: string;
  publishedAt: string | null;
  manifest: Manifest;
  bundle: GithubAsset;
  /** Bytes des Siegels (`SOS-SEAL`): geprüft (Signatur, Kette, Ablauf) und mit dem Manifest abgeglichen; der Installer legt es in den Versionsordner */
  seal: Buffer;
  /** Ablaufdatum der Beglaubigung des Signaturschlüssels (JJJJ-MM-TT), wenn nicht der eingebaute Release-Schlüssel signiert hat */
  endorsedUntil?: string;
};

const baseHeaders = (accept: string) => ({ Accept: accept, "User-Agent": "SchrauberOS-Updater", "X-GitHub-Api-Version": "2022-11-28" });

/** Übersetzt Verstöße gegen die Abruf-Regeln (fremder Host, schlechte Weiterleitung) in einen Fehler des Releases, alles andere in „Netzwerk“. */
function asUpdateError(error: unknown): UpdateError {
  return error instanceof FetchPolicyError ? new UpdateError("badRelease", error.code) : new UpdateError("network");
}

/**
 * Ruft eine Adresse bei GitHub ab (mit dem Update-Token, falls eingerichtet – nur an die API; Weiterleitungen nur auf die Content-Server von GitHub und ohne Token,
 * siehe `lib/updates/safe-fetch.ts`). `metadata`: Abfrage der API selbst (ein Ziel auf derselben Herkunft behält das Token).
 */
async function githubFetch(url: string, accept: string, options: { timeoutMs?: number; metadata?: boolean } = {}): Promise<Response> {
  try {
    return await fetchWithPolicy(url, baseHeaders(accept), await fetchPolicy({ timeoutMs: options.timeoutMs ?? 15_000, sameOriginRedirectKeepsAuth: options.metadata ?? false }));
  } catch (error) {
    throw asUpdateError(error);
  }
}

/** Download eines Release-Assets (Paket): Token nur an die API, die Weiterleitung auf den Content-Server geht ohne Token. */
export const downloadAsset = (url: string, timeoutMs: number) => githubFetch(url, "application/octet-stream", { timeoutMs });

const request = (url: string, accept: string) => githubFetch(url, accept, { metadata: true });

/** Obergrenze für kleine Assets (Manifest, Signatur, Schlüsselliste): gemeldete **und** tatsächlich gelesene Größe. */
export const SMALL_ASSET_MAX_BYTES = 64 * 1024;

/** Liest einen Body höchstens bis `max` Bytes; mehr → `null` (der Rest wird verworfen, die Verbindung abgebrochen). */
export async function readCapped(body: ReadableStream<Uint8Array> | null, max: number): Promise<Buffer | null> {
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function smallAsset(asset: GithubAsset): Promise<Buffer> {
  if (asset.size > SMALL_ASSET_MAX_BYTES) throw new UpdateError("badRelease", `${asset.name} zu groß`);
  const res = await githubFetch(asset.url, "application/octet-stream");
  if (!res.ok) throw new UpdateError("badRelease", `${asset.name}: HTTP ${res.status}`);
  // Die gemeldete Größe ist nur eine Angabe der Gegenseite: auch das tatsächlich Gelesene wird begrenzt
  const data = await readCapped(res.body, SMALL_ASSET_MAX_BYTES);
  if (!data) throw new UpdateError("badRelease", `${asset.name} zu groß`);
  return data;
}

/** Lädt das neueste Release, prüft die Signatur des Manifests und liefert die verifizierten Angaben. */
async function loadLatestRelease(): Promise<Release> {
  const { repo, apiUrl, builtInKey, rootKey, token } = await updateConfig();
  const res = await request(`${apiUrl}/repos/${repo}/releases/latest`, "application/vnd.github+json");
  if (res.status === 401 || res.status === 403) throw new UpdateError("unauthorized");
  // Bei privaten Repos antwortet GitHub ohne gültiges Token mit 404
  if (res.status === 404) throw new UpdateError(token ? "noRelease" : "unauthorized");
  if (!res.ok) throw new UpdateError("network", `HTTP ${res.status}`);

  const release = (await res.json()) as GithubRelease;
  const find = (name: string) => release.assets?.find((a) => a.name === name);
  const manifestAsset = find("manifest.json");
  const signatureAsset = find("manifest.json.sig");
  if (!manifestAsset || !signatureAsset) throw new UpdateError("badRelease", "Manifest oder Signatur fehlt");

  // Vertraut wird dem eingebauten Release-Schlüssel und Schlüsseln, die der Wurzelschlüssel beglaubigt hat (gemerkte und die des Releases)
  let offered: ReturnType<typeof parseEndorsements> = [];
  const keysAsset = find("release-keys.json");
  if (keysAsset) {
    try {
      offered = parseEndorsements(JSON.parse((await smallAsset(keysAsset)).toString("utf8")));
    } catch {
      offered = []; // eine kaputte Schlüsselliste macht das Release nicht unlesbar – es zählt nur der Schlüssel, der passt
    }
  }
  const stored = readEndorsements();
  const keys = trustedReleaseKeys({ root: rootKey, builtIn: [builtInKey], endorsements: [...stored, ...offered] });
  const manifest = verifyManifest(await smallAsset(manifestAsset), await smallAsset(signatureAsset), keys);
  // Erst nach erfolgreicher Prüfung merken (nur Beglaubigungen, die die Kette bestehen)
  const remember = validEndorsements([...stored, ...offered], rootKey);
  if (remember.length !== stored.length || remember.some((e, i) => e.statement !== stored[i]?.statement)) writeEndorsements(remember);
  if (release.tag_name !== `v${manifest.version}`) throw new UpdateError("badRelease", "Tag passt nicht zum Manifest");
  const bundle = find(manifest.asset);
  if (!bundle) throw new UpdateError("badRelease", "Paket fehlt");

  // Das Siegel gehört dem Release wie das Manifest und wird vor dem Download des (großen) Pakets geprüft: Signatur über die Schlüsselkette (die Beglaubigung steckt
  // im Siegel selbst), Ablauf der Beglaubigung gegen die Uhr, und es muss zu dem passen, was das Manifest ankündigt.
  const sealAsset = find("SOS-SEAL");
  if (!sealAsset) throw new UpdateError("badRelease", "Siegel (SOS-SEAL) fehlt");
  if (sealAsset.size > SEAL_MAX_BYTES) throw new UpdateError("badRelease", "SOS-SEAL zu groß");
  const sealBytes = await smallAsset(sealAsset);
  const releaseKey = pemToRawKey(builtInKey);
  const rootRaw = pemToRawKey(rootKey);
  if (!releaseKey || !rootRaw) throw new UpdateError("badSignature");
  const sealCheck = verifySeal(sealBytes, { releaseKey, rootKey: rootRaw }, new Date());
  if (!sealCheck.ok) throw new UpdateError(sealCheck.reason === "endorsement-expired" ? "sealExpired" : sealCheck.code === 11 ? "badSignature" : "badRelease", `Siegel: ${sealCheck.reason}`);
  const { seal } = sealCheck;
  if (seal.version !== manifest.version || seal.base !== manifest.base || seal.arch !== manifest.arch) throw new UpdateError("badRelease", "Siegel passt nicht zum Manifest");

  return { version: manifest.version, notes: release.body ?? "", publishedAt: release.published_at, manifest, bundle, seal: sealBytes, ...(seal.endorsedUntil ? { endorsedUntil: seal.endorsedUntil } : {}) };
}

export type ReleaseCheck = { at: number; release: Release } | { at: number; error: UpdateError["code"] };

const TTL_MS = 60 * 60 * 1000;
let cached: ReleaseCheck | null = null;

/** Neuestes Release mit einstündigem Zwischenspeicher; `force` fragt immer neu bei GitHub an. */
export async function checkLatestRelease(force = false): Promise<ReleaseCheck> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached;
  try {
    cached = { at: Date.now(), release: await loadLatestRelease() };
  } catch (error) {
    cached = { at: Date.now(), error: error instanceof UpdateError ? error.code : "network" };
  }
  return cached;
}

/** Änderungsprotokoll („Was ist neu“) einer Version: die Notizen des GitHub-Releases (nicht signiert – nur zur Anzeige, nie Grundlage einer Entscheidung). */
export type ReleaseNotes = { version: string; notes: string; publishedAt: string | null; /** aus der Kopie im Datenverzeichnis (GitHub nicht erreichbar) */ fromCopy?: boolean };

/** Mehr zeigt die Seite nicht (ein Release mit Fremdtext in Megabyte-Größe soll weder Speicher noch Seite sprengen). */
export const NOTES_MAX_CHARS = 20_000;

const notesCache = new Map<string, { at: number; value: ReleaseNotes | null }>();

/**
 * Notizen des Releases einer bestimmten Version (`/releases/tags/v<version>`). Wirft nie. Mit Zwischenspeicher (eine Stunde), damit das Öffnen der Update-Seite nicht jedes Mal bei
 * GitHub anfragt. **Offline-tauglich:** Jede erfolgreich geholte Notiz wird als Kopie im Datenverzeichnis abgelegt (`<Daten>/app/notes/<version>.md`, siehe `lib/updates/store.ts`);
 * ist GitHub nicht erreichbar, zeigt die Seite diese Kopie – so steht „Was ist neu“ der **installierten** Version auch ohne Netz da, sobald sie einmal geladen wurde (das Paket selbst
 * bringt keine Notizen mit: Sie entstehen erst mit dem Release, nach dem Bau des Pakets). `null`, wenn es weder ein Release noch eine Kopie gibt.
 */
export async function fetchReleaseNotes(version: string, force = false): Promise<ReleaseNotes | null> {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return null; // lokale Entwicklungsstände (0.1.0-dev …) haben kein Release
  const hit = notesCache.get(version);
  if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value: ReleaseNotes | null = null;
  try {
    const { repo, apiUrl } = await updateConfig();
    const res = await request(`${apiUrl}/repos/${repo}/releases/tags/v${version}`, "application/vnd.github+json");
    if (res.ok) {
      const release = (await res.json()) as Partial<GithubRelease>;
      if (typeof release.body === "string" && release.body.trim()) value = { version, notes: release.body.slice(0, NOTES_MAX_CHARS), publishedAt: typeof release.published_at === "string" ? release.published_at : null };
    }
  } catch {
    value = null;
  }
  if (value) writeNotesCopy(version, value);
  else {
    const copy = readNotesCopy(version);
    if (copy) value = { version, notes: copy.slice(0, NOTES_MAX_CHARS), publishedAt: null, fromCopy: true };
  }
  notesCache.set(version, { at: Date.now(), value });
  return value;
}

/** Nur für Tests: Zwischenspeicher der Notizen leeren. */
export const clearNotesCacheForTest = () => notesCache.clear();
