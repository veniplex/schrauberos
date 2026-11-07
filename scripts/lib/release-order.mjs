// Reihenfolge der Versions-Tags: Ein Tag darf "latest" und "X.Y" nur setzen, wenn kein anderer veröffentlichter Versions-Tag höher ist. Der Job "guard" prüft nur, dass der
// Tag-Commit auf main liegt – ein Tag auf einem alten main-Commit mit passender package.json-Version würde "latest" sonst auf einen älteren Stand zurückdrehen.
import { compareVersions } from "../../src/lib/updates/semver.ts";

const STABLE = /^v(\d+\.\d+\.\d+)$/;

/** Die Version eines Tags `vX.Y.Z` (nur veröffentlichte Versionen, ohne Vorabzusatz); sonst `null`. */
export const stableVersionOfTag = (tag) => STABLE.exec(tag)?.[1] ?? null;

/** Alle anderen Versions-Tags (aus `existing`), deren Version höher ist als die von `tag`. Vorabversionen und Fremdes zählen weder als Tag noch als Gegenstück. */
export function higherStableTags(tag, existing) {
  const own = stableVersionOfTag(tag);
  if (!own) return [];
  return existing.filter((other) => other !== tag && stableVersionOfTag(other) && compareVersions(stableVersionOfTag(other), own) > 0);
}
