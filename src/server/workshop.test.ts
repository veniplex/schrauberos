import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { logoSrc } from "@/lib/logo";
import { createTestEnv, type TestEnv } from "@/test/harness";

/** Werkstattprofil (Z6-3 M-3): Das Logo und die Bank-/Steuerdaten werden nicht bei jeder Anfrage gelesen. */
let env: TestEnv;
let workshop: typeof import("./workshop");
before(async () => {
  env = await createTestEnv();
  workshop = await import("./workshop");
});
after(() => env.cleanup());

describe("Werkstattprofil: schmale Zugriffe", () => {
  it("getWorkshop liest weder das Logo noch IBAN, BIC, Bank, USt-IdNr. oder Steuernummer; logoMime nennt den Typ", async () => {
    const logo = `data:image/png;base64,${Buffer.from("PNGDATEN".repeat(5000)).toString("base64")}`;
    await env.db.workshop.upsert({ where: { id: "default" }, update: { logoDataUrl: logo, iban: "DE89370400440532013000", vatId: "DE123456789", taxNumber: "12/345/67890", bankName: "Testbank", bic: "COBADEFFXXX" }, create: { id: "default", logoDataUrl: logo, iban: "DE89370400440532013000", vatId: "DE123456789", taxNumber: "12/345/67890", bankName: "Testbank", bic: "COBADEFFXXX" } });
    const profile = await workshop.getWorkshop();
    const json = JSON.stringify(profile);
    for (const secret of ["DE89370400440532013000", "DE123456789", "12/345/67890", "Testbank", "COBADEFFXXX", "PNGDATEN"]) assert.ok(!json.includes(secret), `${secret} steht nicht im Profil`);
    for (const key of ["logoDataUrl", "iban", "bic", "bankName", "vatId", "taxNumber"]) assert.ok(!(key in profile), key);
    assert.equal(profile.logoMime, "image/png");
    assert.match(logoSrc(profile) ?? "", /^\/api\/logo\?v=\d+$/);
    assert.equal(profile.name.length > 0, true);
  });

  it("getWorkshopBilling hat Bank- und Steuerdaten, aber nie das Logo; getWorkshopLogo liefert nur das Logo", async () => {
    const billing = await workshop.getWorkshopBilling();
    assert.equal(billing.iban, "DE89370400440532013000");
    assert.equal(billing.vatId, "DE123456789");
    assert.ok(!("logoDataUrl" in billing));
    const logo = await workshop.getWorkshopLogo();
    assert.match(logo ?? "", /^data:image\/png;base64,/);
  });

  it("ohne Logo: logoMime ist null und es gibt keine Adresse; ein gespeichertes SVG zählt nicht als Logo", async () => {
    await env.db.workshop.update({ where: { id: "default" }, data: { logoDataUrl: null } });
    // (React-cache gilt je Anfrage: in Tests ohne Anfrage liest jeder Aufruf neu)
    assert.equal((await workshop.getWorkshop()).logoMime, null);
    await env.db.workshop.update({ where: { id: "default" }, data: { logoDataUrl: "data:image/svg+xml;base64,PHN2Zy8+" } });
    const svg = await workshop.getWorkshop();
    assert.equal(svg.logoMime, null);
    assert.equal(logoSrc(svg), null);
  });
});
