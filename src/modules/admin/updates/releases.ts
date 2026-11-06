import "server-only";
import { updateConfig } from "./config";
import { UpdateError, verifyManifest, type Manifest } from "./manifest";

type GithubAsset = { name: string; url: string; size: number };
type GithubRelease = { tag_name: string; body: string | null; published_at: string | null; assets: GithubAsset[] };

export type Release = {
  version: string;
  notes: string;
  publishedAt: string | null;
  manifest: Manifest;
  bundle: GithubAsset;
};

const headers = async (accept: string) => {
  const { token } = await updateConfig();
  return {
    Accept: accept,
    "User-Agent": "SchrauberOS-Updater",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

/** Header (inkl. Token) für den Download eines Release-Assets. */
export const assetHeaders = () => headers("application/octet-stream");

async function request(url: string, accept: string): Promise<Response> {
  try {
    return await fetch(url, { headers: await headers(accept), signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new UpdateError("network");
  }
}

async function smallAsset(asset: GithubAsset): Promise<Buffer> {
  if (asset.size > 64 * 1024) throw new UpdateError("badRelease", `${asset.name} zu groß`);
  const res = await request(asset.url, "application/octet-stream");
  if (!res.ok) throw new UpdateError("badRelease", `${asset.name}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Lädt das neueste Release, prüft die Signatur des Manifests und liefert die verifizierten Angaben. */
async function loadLatestRelease(): Promise<Release> {
  const { repo, apiUrl, publicKey, token } = await updateConfig();
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

  const manifest = verifyManifest(await smallAsset(manifestAsset), await smallAsset(signatureAsset), publicKey);
  if (release.tag_name !== `v${manifest.version}`) throw new UpdateError("badRelease", "Tag passt nicht zum Manifest");
  const bundle = find(manifest.asset);
  if (!bundle) throw new UpdateError("badRelease", "Paket fehlt");

  return { version: manifest.version, notes: release.body ?? "", publishedAt: release.published_at, manifest, bundle };
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
