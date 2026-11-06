import assert from "node:assert/strict";
import { describe, it } from "node:test";
import nextConfig from "../next.config";

describe("next.config: Basis-Header", () => {
  it("setzt auf allen Pfaden nosniff, Referrer-Policy, X-Frame-Options SAMEORIGIN und frame-ancestors 'self'", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*");
    assert.ok(all, "Regel für alle Pfade fehlt");
    const header = (key: string) => all.headers.find((h) => h.key === key)?.value;
    assert.equal(header("X-Content-Type-Options"), "nosniff");
    assert.equal(header("Referrer-Policy"), "strict-origin-when-cross-origin");
    assert.equal(header("X-Frame-Options"), "SAMEORIGIN");
    assert.equal(header("Content-Security-Policy"), "frame-ancestors 'self'");
  });
});
