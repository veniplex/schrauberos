import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";

/** Arbeitsplätze und Terminarten hängen am eigenen Recht `appointments.configure`, nicht mehr an `settings.manage`. */
let env: TestEnv;
let actions: typeof import("./actions");
before(async () => {
  env = await createTestEnv();
  actions = await import("./actions");
});
after(() => env.cleanup());

describe("Arbeitsplätze und Terminarten", () => {
  it("settings.manage allein genügt nicht", async () => {
    const user = await env.user({ username: "settings", roles: [await env.role({ permissions: ["settings.manage", "appointments.view"] })] });
    await env.signIn(user);
    assert.equal(await redirectOf(() => actions.saveBay(form({ name: "Grube", sortOrder: 1 }))), "/forbidden");
    assert.equal(await redirectOf(() => actions.saveAppointmentType(form({ name: "Test", color: "#112233", defaultMinutes: 30 }))), "/forbidden");
    assert.equal(await env.db.bay.count(), 0);
  });

  it("appointments.configure darf Arbeitsplätze und Terminarten pflegen", async () => {
    const user = await env.user({ username: "configure", roles: [await env.role({ permissions: ["appointments.configure"] })] });
    await env.signIn(user);
    await actions.saveBay(form({ name: "Grube", sortOrder: 1 }));
    await actions.saveAppointmentType(form({ name: "Test", color: "#112233", defaultMinutes: 30 }));
    assert.equal(await env.db.bay.count({ where: { name: "Grube" } }), 1);
    assert.equal(await env.db.appointmentType.count({ where: { name: "Test" } }), 1);
  });
});
