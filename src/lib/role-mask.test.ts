import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterMask, rolePreview, togglePermission, toggleGroupPermissions, type MaskSection, type PreviewData } from "./role-mask";

const GROUP = ["appointments.view", "appointments.create", "appointments.edit", "appointments.delete"] as const;
const none = new Set<string>();

describe("Rollenmaske: Bearbeiten setzt Ansehen", () => {
  it("wer ein Recht der Gruppe anwählt, bekommt „Ansehen“ dazu", () => {
    for (const key of ["appointments.create", "appointments.edit", "appointments.delete"]) {
      const next = togglePermission(new Set(), key, true, GROUP, none);
      assert.deepEqual([...next].sort(), ["appointments.view", key].sort(), key);
    }
  });

  it("„Ansehen“ selbst zieht nichts nach; abwählen von „Ansehen“ entfernt die übrigen Rechte der Gruppe", () => {
    assert.deepEqual([...togglePermission(new Set(), "appointments.view", true, GROUP, none)], ["appointments.view"]);
    const all = new Set<string>([...GROUP, "tires.view"]);
    assert.deepEqual([...togglePermission(all, "appointments.view", false, GROUP, none)], ["tires.view"]);
  });

  it("ein einzelnes Recht abwählen lässt „Ansehen“ stehen", () => {
    const next = togglePermission(new Set(GROUP), "appointments.edit", false, GROUP, none);
    assert.equal(next.has("appointments.edit"), false);
    assert.equal(next.has("appointments.view"), true);
  });

  it("gesperrte Rechte bleiben unverändert: „Ansehen“ wird nicht gesetzt, wenn man es nicht vergeben darf; beim Abwählen bleiben gesperrte stehen", () => {
    const locked = new Set(["appointments.view", "appointments.delete"]);
    assert.equal(togglePermission(new Set(), "appointments.edit", true, GROUP, locked).has("appointments.view"), false);
    const next = togglePermission(new Set(GROUP), "appointments.create", false, GROUP, locked);
    assert.equal(next.has("appointments.create"), false);
    // „Ansehen“ ist gesperrt und lässt sich nicht umschalten
    assert.deepEqual([...togglePermission(new Set(GROUP), "appointments.view", false, GROUP, locked)].sort(), [...GROUP].sort());
    const viewOnly = new Set(["appointments.create", "appointments.edit"]);
    assert.deepEqual([...togglePermission(viewOnly, "appointments.view", false, GROUP, new Set(["appointments.delete"]))], [], "beim Abwählen von Ansehen fallen nur ungesperrte Rechte");
  });

  it("Gruppe an-/abwählen überspringt gesperrte Rechte", () => {
    const locked = new Set(["appointments.delete"]);
    assert.deepEqual([...toggleGroupPermissions(new Set(), GROUP, true, locked)].sort(), ["appointments.create", "appointments.edit", "appointments.view"]);
    assert.deepEqual([...toggleGroupPermissions(new Set(GROUP), GROUP, false, locked)], ["appointments.delete"]);
  });

  it("verändert die übergebene Auswahl nicht", () => {
    const before = new Set(["appointments.view"]);
    togglePermission(before, "appointments.edit", true, GROUP, none);
    assert.deepEqual([...before], ["appointments.view"]);
  });
});

const SECTIONS: MaskSection[] = [
  {
    moduleId: "workshop",
    moduleName: "Werkstatt",
    groups: [
      {
        group: "customers",
        label: "Kunden",
        inactive: false,
        keys: [
          { key: "customers.view", label: "Kunden ansehen", hint: "Kunden mit Adresse, Telefon und E-Mail ansehen." },
          { key: "customers.export", label: "Kunden exportieren (CSV)", hint: "Alle Kunden als CSV-Datei herunterladen.", mark: "Export" },
        ],
      },
      { group: "tires", label: "Reifenlager", inactive: false, keys: [{ key: "tires.view", label: "Reifenlager ansehen", hint: "Reifensätze und ihren Lagerort ansehen." }] },
    ],
  },
  { moduleId: "office", moduleName: "Büro", groups: [{ group: "invoices", label: "Rechnungsarchiv", inactive: true, keys: [{ key: "invoices.view", label: "Rechnungen ansehen", hint: "Rechnungen und Belege ansehen." }] }] },
];

describe("Rollenmaske: Suche (filterMask)", () => {
  it("leerer Suchtext zeigt alles", () => {
    assert.equal(filterMask(SECTIONS, "  ").length, 2);
  });
  it("Gruppenname trifft: die ganze Gruppe bleibt; Modulname zählt mit", () => {
    const result = filterMask(SECTIONS, "KUNDEN");
    assert.deepEqual(result.map((s) => s.groups.map((g) => [g.group, g.keys.length])), [[["customers", 2]]]);
    assert.deepEqual(filterMask(SECTIONS, "büro").map((s) => s.moduleId), ["office"]);
  });
  it("sonst nur die passenden Rechte – nach Name, Kurzbeschreibung oder Kennzeichnung, Umlaute und Schreibung egal", () => {
    assert.deepEqual(filterMask(SECTIONS, "export")[0].groups[0].keys.map((k) => k.key), ["customers.export"]);
    assert.deepEqual(filterMask(SECTIONS, "lagerort")[0].groups[0].keys.map((k) => k.key), ["tires.view"]);
    assert.deepEqual(filterMask(SECTIONS, "belege")[0].groups[0].keys.map((k) => k.key), ["invoices.view"]);
    assert.deepEqual(filterMask(SECTIONS, "telefon e-mail").length, 1);
  });
  it("kein Treffer: leer", () => {
    assert.deepEqual(filterMask(SECTIONS, "gibtesnicht"), []);
  });
});

describe("Rollenmaske: Vorschau (rolePreview)", () => {
  const entry = (id: string, feature: string, permission: string) => ({ id, feature, permission, label: id, moduleName: "x" });
  const data: PreviewData = {
    nav: [entry("customers", "workshop.customers", "customers.view"), entry("invoices", "office.invoices", "invoices.view"), entry("tires", "workshop.tires", "tires.view")],
    widgets: [entry("tire-swap", "workshop.tires", "tires.view"), entry("invoices-open", "office.invoices", "invoices.view")],
    actions: [entry("customers.new", "workshop.customers", "customers.edit")],
    inactiveFeatures: ["office.invoices"],
  };
  it("zeigt, was die gewählten Rechte freischalten – ohne Funktionen, die ausgeschaltet sind (die zählen als wartend)", () => {
    const preview = rolePreview(new Set(["customers.view", "invoices.view", "tires.view"]), data);
    assert.deepEqual(preview.nav.map((e) => e.id), ["customers", "tires"]);
    assert.deepEqual(preview.widgets.map((e) => e.id), ["tire-swap"]);
    assert.deepEqual(preview.actions, []);
    assert.equal(preview.waiting, 2, "Navigation und Baustein der ausgeschalteten Rechnungen");
  });
  it("Schnellaktion braucht ihr eigenes Recht; ohne Rechte bleibt nichts", () => {
    assert.deepEqual(rolePreview(new Set(["customers.edit"]), data).actions.map((e) => e.id), ["customers.new"]);
    const none = rolePreview(new Set(), data);
    assert.deepEqual([none.nav, none.widgets, none.actions, none.waiting], [[], [], [], 0]);
  });
});
