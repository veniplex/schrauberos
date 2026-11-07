import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { User } from "@/generated/prisma/client";
import { createTestEnv, type TestEnv } from "@/test/harness";

/**
 * Seitentitel der Detailseiten (`generateMetadata`) tragen Kundennamen, Kennzeichen, Rechnungsnummern …. Sie werden schon im ersten gestreamten
 * HTML ausgeliefert, bevor die Seite selbst ihr Recht prüft – sie dürfen deshalb nur mit dem Recht der Seite aus der Datenbank gelesen werden.
 */
const SECRET = "Geheim-Muster-4711";

type Case = {
  name: string;
  permission: string;
  /** Legt den Datensatz an und liefert den Parameter der Seite */
  seed: (env: TestEnv) => Promise<Record<string, string>>;
  load: () => Promise<{ generateMetadata: (props: { params: Promise<Record<string, string>> }) => Promise<{ title?: unknown }> }>;
};

const cases: Case[] = [
  {
    name: "Kunde",
    permission: "customers.view",
    seed: async (env) => ({ id: (await env.db.customer.create({ data: { lastName: SECRET } })).id }),
    load: () => import("@/app/(app)/(workshop)/customers/[id]/page") as never,
  },
  {
    name: "Fahrzeug",
    permission: "vehicles.view",
    seed: async (env) => ({ id: (await env.db.vehicle.create({ data: { plate: `${SECRET}-FZ`, plateNorm: "GEHEIMFZ" } })).id }),
    load: () => import("@/app/(app)/(workshop)/vehicles/[id]/page") as never,
  },
  {
    name: "Reifensatz",
    permission: "tires.view",
    seed: async (env) => {
      const vehicle = await env.db.vehicle.create({ data: { plate: `${SECRET}-RS`, plateNorm: "GEHEIMRS" } });
      return { id: (await env.db.tireSet.create({ data: { vehicleId: vehicle.id, season: "summer" } })).id };
    },
    load: () => import("@/app/(app)/(workshop)/tires/[id]/page") as never,
  },
  {
    name: "Mitarbeiter",
    permission: "employees.view",
    seed: async (env) => ({ id: (await env.db.employee.create({ data: { firstName: "Max", lastName: SECRET } })).id }),
    load: () => import("@/app/(app)/(office)/employees/[id]/page") as never,
  },
  {
    name: "Rechnung",
    permission: "invoices.view",
    seed: async (env) => ({
      id: (await env.db.invoice.create({ data: { direction: "incoming", number: `RE-${SECRET}`, partyName: "Lieferant", issueDate: new Date(), grossCents: 100 } })).id,
    }),
    load: () => import("@/app/(app)/(office)/invoices/[id]/page") as never,
  },
  {
    name: "Fuhrpark-Fahrzeug",
    permission: "fleet.view",
    seed: async (env) => ({ id: (await env.db.fleetVehicle.create({ data: { plate: `${SECRET}-FP` } })).id }),
    load: () => import("@/app/(app)/(office)/fleet/[id]/page") as never,
  },
  {
    name: "Netzwerkgerät",
    permission: "network.view",
    seed: async (env) => ({ id: (await env.db.netDevice.create({ data: { name: SECRET, type: "switch" } })).id }),
    load: () => import("@/app/(app)/(it)/network/devices/[id]/page") as never,
  },
  {
    name: "Dokumentationsseite (IT)",
    permission: "docsIt.view",
    seed: async (env) => {
      await env.db.docPage.create({ data: { area: "it", slug: "geheim-seite", title: SECRET, content: "x" } });
      return { area: "it", slug: "geheim-seite" };
    },
    load: () => import("@/app/(app)/docs/[area]/[slug]/page") as never,
  },
  {
    name: "Subnetz",
    permission: "network.view",
    seed: async (env) => ({ subnetId: (await env.db.netSubnet.create({ data: { name: SECRET, cidr: "10.9.8.0/24" } })).id }),
    load: () => import("@/app/(app)/(it)/network/ip/[subnetId]/page") as never,
  },
];

let env: TestEnv;
let viewer: User;
let outsider: User;
let mustChange: User;

before(async () => {
  env = await createTestEnv();
  const viewerRole = await env.role({ key: "viewer", permissions: [...new Set(cases.map((c) => c.permission))] });
  const emptyRole = await env.role({ key: "empty", permissions: ["appointments.view"] });
  viewer = await env.user({ username: "viewer", roles: [viewerRole] });
  outsider = await env.user({ username: "outsider", roles: [emptyRole] });
  mustChange = await env.user({ username: "neu", roles: [viewerRole], mustChangePassword: true });
});
after(() => env.cleanup());

describe("generateMetadata der Detailseiten verrät ohne Recht nichts", () => {
  for (const c of cases) {
    it(`${c.name}: ohne Sitzung, ohne Recht und mit ausstehendem Passwortwechsel leer; mit Recht der Titel`, async () => {
      const params = await c.seed(env);
      const { generateMetadata } = await c.load();
      const title = () => generateMetadata({ params: Promise.resolve(params) });

      env.signOut();
      assert.deepEqual(await title(), {}, "ohne Sitzung");

      await env.signIn(outsider);
      assert.deepEqual(await title(), {}, "ohne Recht");
      env.signOut();

      await env.signIn(mustChange);
      assert.deepEqual(await title(), {}, "Passwortwechsel steht aus");
      env.signOut();

      await env.signIn(viewer);
      const allowed = await title();
      assert.ok(String(allowed.title).includes(SECRET), `mit Recht muss der Titel kommen, war: ${JSON.stringify(allowed)}`);
      env.signOut();
    });
  }
});
