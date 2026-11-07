import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DUE_TONE } from "@/lib/due";
import { STATUS_TONES } from "@/lib/status-tone";
import { BACKUP_KIND_TONE } from "@/modules/admin/backup/status-tone";
import { MAIL_STATUS_TONE } from "@/modules/admin/mail/status-tone";
import { FEATURE_STATE_TONE } from "@/modules/admin/modules/status-tone";
import { JOB_STATUS_TONE, JOB_STATUSES } from "@/modules/admin/system/status-tone";
import { DEVICE_STATUSES, IP_KINDS } from "@/modules/it/network/constants";
import { DEVICE_STATUS_TONE, IP_KIND_TONE, LINK_STATE_TONE } from "@/modules/it/network/status-tone";
import { ABSENCE_TYPES } from "@/modules/office/employees/domain";
import { ABSENCE_TONE } from "@/modules/office/employees/status-tone";
import { FLEET_STATUSES } from "@/modules/office/fleet/domain";
import { FLEET_STATUS_TONE } from "@/modules/office/fleet/status-tone";
import { PAYMENT_TONE } from "@/modules/office/invoices/status-tone";
import { APPOINTMENT_STATUSES } from "@/modules/workshop/appointments/constants";
import { STATUS_TONE } from "@/modules/workshop/appointments/status-tone";
import { ORDER_STATUSES } from "@/modules/workshop/orders/constants";
import { ORDER_STATUS_TONE } from "@/modules/workshop/orders/status-tone";
import { MOVEMENT_KINDS } from "@/modules/workshop/parts/constants";
import { MOVEMENT_TONE, STOCK_TONE } from "@/modules/workshop/parts/status-tone";
import { TIRE_SEASONS, TIRE_SET_STATUSES } from "@/modules/workshop/tires/constants";
import { HEALTH_TONE, SEASON_TONE, TIRE_SET_STATUS_TONE } from "@/modules/workshop/tires/status-tone";
import { MAIL_STATUSES } from "@/lib/mail";
import { BACKUP_KINDS } from "@/server/backup/kinds";

/**
 * Zuordnung Zustand → Ton der `StatusBadge`: Sie liegt bei der Funktion (`status-tone.ts`), zentral gibt es nur die Töne. Das Typsystem verlangt die Vollständigkeit beim Übersetzen;
 * dieser Test sichert sie gegen die Zustandslisten zur Laufzeit ab (neuer Zustand ohne Ton, überzählige Töne, unbekannter Tonwert).
 */
const MAPS: Array<[string, Record<string, string>, readonly string[]]> = [
  ["Termin", STATUS_TONE, APPOINTMENT_STATUSES],
  ["Auftrag", ORDER_STATUS_TONE, ORDER_STATUSES],
  ["Lagerbewegung", MOVEMENT_TONE, MOVEMENT_KINDS],
  ["Bestand", STOCK_TONE, ["negative", "low", "ok"]],
  ["Reifensatz", TIRE_SET_STATUS_TONE, TIRE_SET_STATUSES],
  ["Saison", SEASON_TONE, TIRE_SEASONS],
  ["Reifenzustand", HEALTH_TONE, ["ok", "warn", "replace", "unknown"]],
  ["Zahlung", PAYMENT_TONE, ["open", "overdue", "paid", "cancelled"]],
  ["Fuhrpark", FLEET_STATUS_TONE, FLEET_STATUSES],
  ["Abwesenheit", ABSENCE_TONE, [...ABSENCE_TYPES, "masked"]],
  ["Gerätestatus", DEVICE_STATUS_TONE, DEVICE_STATUSES],
  ["IP-Art", IP_KIND_TONE, IP_KINDS],
  ["Erreichbarkeit", LINK_STATE_TONE, ["online", "degraded", "offline", "unknown"]],
  ["Fälligkeit", DUE_TONE, ["expired", "soon", "ok"]],
  ["Backup-Art", BACKUP_KIND_TONE, BACKUP_KINDS],
  ["Job-Lauf", JOB_STATUS_TONE, JOB_STATUSES],
  ["Mail-Status", MAIL_STATUS_TONE, MAIL_STATUSES],
  ["Funktion (Module-Seite)", FEATURE_STATE_TONE, ["on", "off", "module-off", "blocked"]],
];

describe("Zustand → Ton", () => {
  for (const [name, map, states] of MAPS) {
    it(`${name}: jeder Zustand hat genau einen gültigen Ton`, () => {
      assert.deepEqual(Object.keys(map).sort(), [...states].sort());
      for (const tone of Object.values(map)) assert.ok((STATUS_TONES as readonly string[]).includes(tone), `${name}: unbekannter Ton ${tone}`);
    });
  }

  it("die Konvention: Fehler/abgelaufen/überfällig sind rot, erledigt/in Ordnung grün", () => {
    assert.equal(DUE_TONE.expired, "danger");
    assert.equal(PAYMENT_TONE.overdue, "danger");
    assert.equal(PAYMENT_TONE.paid, "success");
    assert.equal(STATUS_TONE.cancelled, "danger");
    assert.equal(STATUS_TONE.done, "success");
    assert.equal(HEALTH_TONE.replace, "danger");
    assert.equal(LINK_STATE_TONE.offline, "danger");
    assert.equal(JOB_STATUS_TONE.error, "danger");
  });
});
