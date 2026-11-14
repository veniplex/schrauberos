// Reine Entscheidung für scripts/release-plan.mjs (Test: src/lib/updates/anchor-scripts.test.ts).
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * @param {{ event: string, ref: string, version: string, tags: string[] }} input
 * @returns {{ release: boolean, tag: string, version: string, reason: string, error?: string }}
 */
export function planRelease({ event, ref, version, tags }) {
  const none = (reason) => ({ release: false, tag: "", version, reason });
  if (event !== "push") return none("kein Push (Pull Request oder Lauf von Hand): es wird nie veröffentlicht.");

  if (ref.startsWith("refs/tags/v")) {
    const tag = ref.slice("refs/tags/".length);
    if (tag !== `v${version}`) return { ...none(""), error: `Der Tag ${tag} passt nicht zur Version in package.json (${version}).` };
    return { release: true, tag, version, reason: `Versions-Tag ${tag}.` };
  }

  if (ref !== "refs/heads/main") return none(`Zweig ${ref}: nur main veröffentlicht.`);
  if (!VERSION.test(version)) return { ...none(""), error: `Die Version in package.json (${version}) ist keine Version der Form X.Y.Z.` };
  const tag = `v${version}`;
  if (tags.includes(tag)) return none(`Die Version ${version} ist schon veröffentlicht (Tag ${tag} vorhanden): gewöhnlicher Lauf ohne Release.`);
  return { release: true, tag, version, reason: `Neue Version ${version} auf main (Tag ${tag} fehlt noch).` };
}
