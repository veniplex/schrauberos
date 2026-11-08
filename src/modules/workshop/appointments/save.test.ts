import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { versionOf } from "@/lib/concurrency";
import { createTestEnv, form, redirectOf, type TestEnv } from "@/test/harness";

/** Termine im Aktions-Rahmen: Rechte je Aktion, Audit, optimistische Sperre, Doppelbelegung, Einstellungen. */
let env: TestEnv;
let actions: typeof import("./actions");
before(async () => {
  env = await createTestEnv();
  actions = await import("./actions");
});
after(() => env.cleanup());

describe("Termin: Speichern, Konflikte, Audit", () => {
  const base = { title: "Reifenwechsel", date: "2030-06-03", time: "09:00", duration: 60 };
  let bay: { id: string };

  const login = async (permissions: string[]) => {
    const user = await env.user({ username: `u-${Math.random()}`, roles: [await env.role({ permissions })] });
    await env.signIn(user);
    return user;
  };
  const create = (fields: Record<string, string | number | undefined> = {}) => actions.createAppointment({}, form({ ...base, ...fields }));
  const update = (fields: Record<string, string | number | undefined>) => actions.updateAppointment({}, form({ ...base, ...fields }));

  before(async () => {
    bay = await env.db.bay.create({ data: { name: `Platz ${Math.random()}` } });
  });
  beforeEach(async () => {
    await env.db.appointment.deleteMany();
    await env.db.auditLog.deleteMany();
    env.browser.reset();
  });

  it("Anlegen braucht appointments.create, Ändern appointments.edit – das eine ersetzt nicht das andere", async () => {
    await login(["appointments.view", "appointments.create"]);
    assert.ok(await redirectOf(() => create()));
    const row = await env.db.appointment.findFirstOrThrow();
    assert.equal(await redirectOf(() => update({ id: row.id, version: versionOf(row) })), "/forbidden");

    await login(["appointments.view", "appointments.edit"]);
    assert.equal(await redirectOf(() => create({ title: "Zweiter" })), "/forbidden");
    assert.ok(await redirectOf(() => update({ id: row.id, version: versionOf(row), title: "Geändert" })));
    assert.equal(await env.db.appointment.count(), 1);
  });

  it("Anlegen und Ändern stehen im Audit-Log (Titel, ID), Anlegen nennt den Ersteller", async () => {
    const user = await login(["appointments.create", "appointments.edit"]);
    await redirectOf(() => create());
    const row = await env.db.appointment.findFirstOrThrow();
    assert.equal(row.createdById, user.id);
    await redirectOf(() => update({ id: row.id, version: versionOf(row), title: "Umbenannt" }));
    const entries = await env.db.auditLog.findMany({ orderBy: { createdAt: "asc" } });
    assert.deepEqual(entries.map((e) => [e.action, e.target, e.entityId]), [["appointment.create", "Reifenwechsel", row.id], ["appointment.update", "Umbenannt", row.id]]);
  });

  it("leitet nach dem Speichern zum Tag des Termins oder zum sicheren Rücksprungziel", async () => {
    await login(["appointments.create"]);
    assert.equal(await redirectOf(() => create()), "/appointments?date=2030-06-03");
    assert.equal(await redirectOf(() => create({ returnTo: "/appointments?date=2030-06-10&view=week" })), "/appointments?date=2030-06-10&view=week");
    assert.equal(await redirectOf(() => create({ returnTo: "https://evil.example/" })), "/appointments?date=2030-06-03");
    assert.equal(await redirectOf(() => create({ returnTo: "//evil.example" })), "/appointments?date=2030-06-03");
  });

  it("prüft Eingaben: leerer Titel, ungültiges Datum, Dauer außerhalb 5–720 Minuten", async () => {
    await login(["appointments.create"]);
    assert.ok((await create({ title: "   " })).fieldErrors?.title);
    assert.ok((await create({ date: "2030-02-30" })).fieldErrors?.date);
    assert.ok((await create({ time: "9:00" })).fieldErrors?.time);
    assert.ok((await create({ duration: 4 })).fieldErrors?.duration);
    assert.ok((await create({ duration: 721 })).fieldErrors?.duration);
    assert.equal(await env.db.appointment.count(), 0);
    assert.equal(await env.db.auditLog.count(), 0, "ohne Änderung kein Eintrag");
  });

  it("Doppelbelegung desselben Arbeitsplatzes wird mit der Zeit des Konflikts gemeldet; Anschluss, anderer Platz und abgesagte Termine sind frei", async () => {
    await login(["appointments.create", "appointments.edit"]);
    await redirectOf(() => create({ bayId: bay.id, time: "09:00", duration: 60 }));
    const clash = await create({ title: "Zweiter", bayId: bay.id, time: "09:30" });
    assert.match(clash.fieldErrors?.bayId ?? "", /09:00/);
    assert.match(clash.fieldErrors?.bayId ?? "", /10:00/);
    assert.equal(await env.db.appointment.count(), 1);

    assert.ok(await redirectOf(() => create({ title: "Anschluss", bayId: bay.id, time: "10:00" })), "genau im Anschluss ist frei");
    const other = await env.db.bay.create({ data: { name: `Anderer ${Math.random()}` } });
    assert.ok(await redirectOf(() => create({ title: "Anderer Platz", bayId: other.id, time: "09:00" })));
    assert.ok(await redirectOf(() => create({ title: "Abgesagt", bayId: bay.id, time: "09:15", status: "cancelled" })), "ein abgesagter Termin blockiert nichts");
    assert.equal(await env.db.appointment.count(), 4);

    // Ein Termin kollidiert nicht mit sich selbst; Verschieben auf einen belegten Zeitraum scheitert
    const first = await env.db.appointment.findFirstOrThrow({ where: { title: "Reifenwechsel" } });
    assert.ok(await redirectOf(() => update({ id: first.id, version: versionOf(first), bayId: bay.id, time: "09:00", duration: 30 })));
    const fresh = await env.db.appointment.findFirstOrThrow({ where: { title: "Reifenwechsel" } });
    assert.ok((await update({ id: fresh.id, version: versionOf(fresh), bayId: bay.id, time: "09:30", duration: 60 })).fieldErrors?.bayId);
  });

  it("gleichzeitige Buchungen desselben Platzes: genau eine gewinnt", async () => {
    await login(["appointments.create"]);
    const results = await Promise.all([1, 2, 3].map((n) => redirectOf(() => create({ title: `Gleichzeitig ${n}`, bayId: bay.id, time: "14:00" })).catch(() => "fehler")));
    // erfolgreiche Aktionen enden mit einer Weiterleitung, abgelehnte liefern einen Formularzustand (kein Redirect)
    assert.equal(results.filter((target) => target).length, 1);
    assert.equal(await env.db.appointment.count({ where: { bayId: bay.id } }), 1);
  });

  it("veraltete Version meldet einen Konflikt und überschreibt nichts", async () => {
    await login(["appointments.create", "appointments.edit"]);
    await redirectOf(() => create());
    const row = await env.db.appointment.findFirstOrThrow();
    const stale = versionOf(row);
    await redirectOf(() => update({ id: row.id, version: stale, notes: "erste Änderung" }));
    const state = await update({ id: row.id, version: stale, notes: "veraltet" });
    assert.ok(state.error);
    assert.equal((await env.db.appointment.findUniqueOrThrow({ where: { id: row.id } })).notes, "erste Änderung");
    assert.ok((await update({ id: row.id, notes: "ohne Version" })).error, "ohne Version wird nie überschrieben");
  });

  it("Ändern eines unbekannten Termins meldet einen Fehler statt einen neuen anzulegen", async () => {
    await login(["appointments.edit"]);
    const state = await update({ id: "gibt-es-nicht", version: "1" });
    assert.ok(state.error);
    assert.equal(await env.db.appointment.count(), 0);
  });

  it("Löschen: braucht appointments.delete, protokolliert und folgt dem Rücksprungziel; doppeltes Löschen schreibt keinen zweiten Eintrag", async () => {
    const row = await env.db.appointment.create({ data: { title: "Weg damit", startsAt: new Date(), endsAt: new Date(Date.now() + 3600_000) } });
    await login(["appointments.view", "appointments.edit"]);
    assert.equal(await redirectOf(() => actions.deleteAppointment(form({ id: row.id }))), "/forbidden");
    assert.equal(await env.db.appointment.count(), 1);

    await login(["appointments.delete"]);
    assert.equal(await redirectOf(() => actions.deleteAppointment(form({ id: row.id, returnTo: "/appointments?date=2030-01-01" }))), "/appointments?date=2030-01-01");
    assert.equal(await env.db.appointment.count(), 0);
    const entry = await env.db.auditLog.findFirstOrThrow({ where: { action: "appointment.delete" } });
    assert.equal(entry.target, "Weg damit");
    assert.equal(entry.entityId, row.id);
    await redirectOf(() => actions.deleteAppointment(form({ id: row.id })));
    assert.equal(await env.db.auditLog.count({ where: { action: "appointment.delete" } }), 1);
  });

  it("Kalender-Einstellungen: Reihenfolge der Stunden wird geprüft, Speichern wird protokolliert", async () => {
    await login(["appointments.configure"]);
    const bad = await actions.saveAppointmentSettings({}, form({ dayStartHour: 12, dayEndHour: 8, slotMinutes: 30 }));
    assert.ok(bad.fieldErrors?.dayEndHour);
    assert.ok((await actions.saveAppointmentSettings({}, form({ dayStartHour: 7, dayEndHour: 18, slotMinutes: 7 }))).fieldErrors?.slotMinutes);
    const good = await actions.saveAppointmentSettings({}, form({ dayStartHour: 7, dayEndHour: 18, slotMinutes: 15 }));
    assert.equal(good.ok, true);
    const saved = await env.db.appointmentSettings.findUniqueOrThrow({ where: { id: "default" } });
    assert.deepEqual([saved.dayStartHour, saved.dayEndHour, saved.slotMinutes], [7, 18, 15]);
    assert.equal(await env.db.auditLog.count({ where: { action: "settings.appointments" } }), 1);
  });

  it("Arbeitsplätze und Terminarten: Anlegen, Bearbeiten, Archivieren, Löschen (nur ohne Termine) – jeweils im Audit-Log", async () => {
    await login(["appointments.configure"]);
    await actions.saveBay(form({ name: "Grube 7", sortOrder: 2 }));
    const created = await env.db.bay.findFirstOrThrow({ where: { name: "Grube 7" } });
    assert.equal(created.active, true, "neue Arbeitsplätze sind aktiv");
    const bayVersion = versionOf(created);
    await actions.saveBay(form({ id: created.id, version: bayVersion, name: "Grube 7", sortOrder: 2 })); // Speichern ändert den Archivstatus nicht
    // Z7: Konfigurationszeilen tragen eine Version – wer mit dem alten Stand speichert (oder ganz ohne Version), überschreibt nichts
    await actions.saveBay(form({ id: created.id, version: bayVersion, name: "Veraltet", sortOrder: 9 }));
    await actions.saveBay(form({ id: created.id, name: "Ohne Version", sortOrder: 9 }));
    assert.deepEqual((await env.db.bay.findUniqueOrThrow({ where: { id: created.id } })).name, "Grube 7", "der Konflikt überschreibt nichts");
    assert.equal((await env.db.bay.findUniqueOrThrow({ where: { id: created.id } })).active, true);
    await actions.saveAppointmentType(form({ name: "Sonderart", color: "#112233", defaultMinutes: 45 }));
    const type = await env.db.appointmentType.findFirstOrThrow({ where: { name: "Sonderart" } });
    await actions.saveAppointmentType(form({ name: "Sonderart", color: "kein-hex", defaultMinutes: 45, id: type.id, version: versionOf(type) }));
    await actions.saveAppointmentType(form({ name: "Veraltet", color: "#445566", defaultMinutes: 45, id: type.id, version: String(Number(versionOf(type)) - 5) }));
    assert.equal((await env.db.appointmentType.findUniqueOrThrow({ where: { id: type.id } })).name, "Sonderart", "veraltete Version: Konflikt");
    assert.equal((await env.db.appointmentType.findUniqueOrThrow({ where: { id: type.id } })).color, "#112233", "ungültige Farbe wird nicht gespeichert");
    // Löschschutz: Hängen Termine daran, ist Löschen gesperrt – archiviert wird stattdessen (der Termin behält Platz und Art)
    await env.db.appointment.create({ data: { title: "Hängt dran", startsAt: new Date("2030-06-03T07:00:00Z"), endsAt: new Date("2030-06-03T08:00:00Z"), bayId: created.id, typeId: type.id } });
    await actions.deleteBay(form({ id: created.id }));
    await actions.deleteAppointmentType(form({ id: type.id }));
    assert.equal(await env.db.bay.count({ where: { id: created.id } }), 1, "mit Termin nicht löschbar");
    assert.equal(await env.db.appointmentType.count({ where: { id: type.id } }), 1);
    await actions.archiveBay(form({ id: created.id, archived: "1" }));
    await actions.archiveAppointmentType(form({ id: type.id, archived: "1" }));
    assert.equal((await env.db.bay.findUniqueOrThrow({ where: { id: created.id } })).active, false);
    assert.equal((await env.db.appointmentType.findUniqueOrThrow({ where: { id: type.id } })).active, false);
    const kept = await env.db.appointment.findFirstOrThrow({ where: { title: "Hängt dran" } });
    assert.deepEqual([kept.bayId, kept.typeId], [created.id, type.id], "die Termine behalten Platz und Art");
    await actions.archiveBay(form({ id: created.id, archived: "0" }));
    assert.equal((await env.db.bay.findUniqueOrThrow({ where: { id: created.id } })).active, true, "wieder aktivieren");
    // ohne Termine geht das Löschen
    await env.db.appointment.deleteMany();
    await actions.deleteBay(form({ id: created.id }));
    await actions.deleteAppointmentType(form({ id: type.id }));
    assert.equal(await env.db.bay.count({ where: { id: created.id } }), 0);
    assert.equal(await env.db.appointmentType.count({ where: { id: type.id } }), 0);
    assert.equal(await env.db.auditLog.count({ where: { action: "settings.appointments" } }), 8, "Anlegen, Bearbeiten, Anlegen, 2 × Archivieren, Wiederaktivieren, 2 × Löschen (abgelehnte Eingaben zählen nicht)");
  });
});
