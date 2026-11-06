import { createPublicKey, verify } from "node:crypto";
import { z } from "zod";
import { isCompatible, type VersionMeta } from "@/lib/updates/state";

/** Größtes akzeptiertes Release-Paket (Schutz vor versehentlich/böswillig riesigen Downloads). */
export const MAX_BUNDLE_BYTES = 400 * 1024 * 1024;

export type UpdateErrorCode =
  | "network"
  | "unauthorized"
  | "noRelease"
  | "badRelease"
  | "badSignature"
  | "badChecksum"
  | "tooLarge"
  | "needsImage"
  | "notNewer"
  | "busy"
  | "pending"
  | "disabled"
  | "extract"
  | "invalidBundle"
  | "backupFailed";

/** Fehler mit festem Code; die Oberfläche übersetzt `updates.errors.<code>`. */
export class UpdateError extends Error {
  constructor(
    readonly code: UpdateErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

/** manifest.json, das die Pipeline erzeugt und signiert. */
export const manifestSchema = z.object({
  schema: z.literal(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  base: z.number().int().min(1),
  arch: z.string().regex(/^[a-z0-9_]+$/),
  asset: z.string().regex(/^[A-Za-z0-9._-]+\.tar\.gz$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().positive().max(MAX_BUNDLE_BYTES),
});
export type Manifest = z.infer<typeof manifestSchema>;

/** Prüft die Ed25519-Signatur über die exakten Bytes des Manifests und liest es dann. */
export function verifyManifest(manifestBytes: Buffer, signature: Buffer, publicKeyPem: string): Manifest {
  let valid = false;
  try {
    valid = verify(null, manifestBytes, createPublicKey(publicKeyPem), signature);
  } catch {
    valid = false;
  }
  if (!valid) throw new UpdateError("badSignature");
  try {
    return manifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
  } catch {
    throw new UpdateError("badRelease", "Manifest ungültig");
  }
}

/** Passt das Release zu diesem Image (Starter-Vertrag, CPU-Architektur)? Sonst ist ein neues Image nötig. */
export const needsNewImage = (manifest: Pick<Manifest, "base" | "arch">, running: VersionMeta) =>
  !isCompatible({ version: "", base: manifest.base, arch: manifest.arch }, { ...running, arch: running.arch ?? process.arch });
