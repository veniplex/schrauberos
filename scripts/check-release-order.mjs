// Gate des Jobs "release": ein Versions-Tag vX.Y.Z (ohne Vorabzusatz) darf "latest" nur setzen, wenn es keinen höheren Versions-Tag gibt. Ein älterer Tag (etwa auf einem alten
// main-Commit mit passender package.json) bricht ab – bevor irgendetwas signiert, veröffentlicht oder umgetaggt wird. Vorabversionen berühren "latest" nie und passieren.
//   node scripts/check-release-order.mjs --tag v1.2.3 [--tags "v1.0.0 v1.2.0"]     (ohne --tags: alle Tags des lokalen Klons, `git tag -l 'v*'`)
import { execFileSync } from "node:child_process";
import { higherStableTags, stableVersionOfTag } from "./lib/release-order.mjs";

const args = process.argv.slice(2);
const valueOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const tag = valueOf("--tag");
if (!tag) {
  console.error("Parameter --tag fehlt.");
  process.exit(2);
}
if (!stableVersionOfTag(tag)) {
  console.log(`${tag} ist eine Vorabversion oder kein Versions-Tag: "latest" bleibt unberührt, keine Reihenfolgeprüfung nötig.`);
  process.exit(0);
}
const existing = (valueOf("--tags") ?? execFileSync("git", ["tag", "-l", "v*"], { encoding: "utf8" })).split(/\s+/).filter(Boolean);
const higher = higherStableTags(tag, existing);
if (higher.length > 0) {
  console.error(`::error::Es gibt bereits einen höheren Versions-Tag (${higher.slice(0, 5).join(", ")}). ${tag} würde "latest" auf einen älteren Stand zurückdrehen – es wird nichts veröffentlicht.`);
  process.exit(1);
}
console.log(`${tag} ist der höchste Versions-Tag.`);
