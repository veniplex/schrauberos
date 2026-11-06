import { z } from "zod";
import type { Tire, TireSet } from "@/generated/prisma/client";
import { versionOf } from "@/lib/concurrency";
import { day, dateOnly, iso } from "@/server/api/format";
import { defineResource, type Delegate } from "@/server/api/resource";
import { db } from "@/server/db";
import { RIM_TYPES, TIRE_CONDITIONS, TIRE_POSITIONS, TIRE_SEASONS, TIRE_SET_STATUSES, type TirePosition } from "./constants";
import { createTireSetOperation, deleteTireSetOperation, setStatusOperation, updateTireSetOperation } from "./operations";

/**
 * API-Ressource „Reifensätze“ (`/api/v1/tire-sets`). Die Einzelreifen stecken im Satz (`tires`, je Position ein Eintrag; `SPARE` nur mit `spare: true`);
 * Anlegen und Ändern laufen über dieselben Operationen wie das Formular (DOT-Prüfung, Profiltiefe 0–15 mm).
 */
type Row = TireSet & { tires: Tire[] };

const ref = z.string().max(64);
const tireRow = z.strictObject({
  /** DOT-Kürzel „WWYY“ (Produktionswoche und -jahr), z. B. „2321“ */
  dot: z.string().max(10).nullable().optional(),
  treadDepthMm: z.number().min(0).max(15).nullable().optional(),
  condition: z.enum(TIRE_CONDITIONS).optional(),
});
const tiresShape = Object.fromEntries(TIRE_POSITIONS.map((p) => [p, tireRow.optional()])) as Record<TirePosition, z.ZodOptional<typeof tireRow>>;

const int = (min: number, max: number) => z.number().int().min(min).max(max).nullable().optional();

const body = z.strictObject({
  vehicleId: ref,
  season: z.enum(TIRE_SEASONS),
  status: z.enum(TIRE_SET_STATUSES).optional(),
  brand: z.string().max(60).nullable().optional(),
  model: z.string().max(60).nullable().optional(),
  width: int(100, 400),
  aspect: int(20, 100),
  rim: int(10, 30),
  loadIndex: z.string().max(5).nullable().optional(),
  speedIndex: z.string().max(3).nullable().optional(),
  rimType: z.enum(RIM_TYPES).optional(),
  storageLocation: z.string().max(120).nullable().optional(),
  storedAt: dateOnly.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  /** Ersatzrad mitführen */
  spare: z.boolean().optional(),
  tires: z.strictObject(tiresShape).optional(),
});

const nullableNumber = z.number().nullable();
const nullableString = z.string().nullable();
const item = z.object({
  id: z.string(),
  version: z.string(),
  vehicleId: z.string(),
  season: z.enum(TIRE_SEASONS),
  status: z.enum(TIRE_SET_STATUSES),
  brand: nullableString,
  model: nullableString,
  width: nullableNumber,
  aspect: nullableNumber,
  rim: nullableNumber,
  loadIndex: nullableString,
  speedIndex: nullableString,
  rimType: z.enum(RIM_TYPES),
  storageLocation: nullableString,
  storedAt: z.string(),
  notes: nullableString,
  tires: z.array(
    z.object({
      position: z.enum(TIRE_POSITIONS),
      dot: nullableString,
      producedYear: nullableNumber,
      producedWeek: nullableNumber,
      treadDepthMm: nullableNumber,
      condition: z.enum(TIRE_CONDITIONS),
    }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const oneOf = <T extends string>(list: readonly T[], value: string, fallback: T): T => ((list as readonly string[]).includes(value) ? (value as T) : fallback);

/** API-Körper → Eingabe der Operation: Einzelreifen als Text (Profiltiefe wie im Formular), Ersatzrad-Schalter, Standardwerte. */
function toInput(b: Record<string, unknown>): Record<string, unknown> {
  const tires: Record<string, { dot?: string; tread?: string; condition?: string }> = {};
  for (const [position, row] of Object.entries((b.tires ?? {}) as Record<string, z.infer<typeof tireRow> | undefined>)) {
    if (!row) continue;
    tires[position] = { dot: row.dot ?? undefined, tread: row.treadDepthMm === null || row.treadDepthMm === undefined ? undefined : String(row.treadDepthMm), condition: row.condition };
  }
  return { ...b, tires, spare: b.spare === true };
}

export const endpoints = defineResource({
  feature: "workshop.tires",
  tag: "Tires",
  name: "tire-sets",
  singular: "tire set",
  path: "/tire-sets",
  read: "tires.view",
  model: db.tireSet as unknown as Delegate<Row>,
  include: { tires: true },
  item,
  version: versionOf,
  toItem: (s): z.input<typeof item> => ({
    id: s.id,
    version: versionOf(s),
    vehicleId: s.vehicleId,
    season: oneOf(TIRE_SEASONS, s.season, "summer"),
    status: oneOf(TIRE_SET_STATUSES, s.status, "stored"),
    brand: s.brand,
    model: s.model,
    width: s.width,
    aspect: s.aspect,
    rim: s.rim,
    loadIndex: s.loadIndex,
    speedIndex: s.speedIndex,
    rimType: oneOf(RIM_TYPES, s.rimType, "none"),
    storageLocation: s.storageLocation,
    storedAt: iso(s.storedAt),
    notes: s.notes,
    tires: [...s.tires]
      .sort((a, b) => TIRE_POSITIONS.indexOf(a.position as TirePosition) - TIRE_POSITIONS.indexOf(b.position as TirePosition))
      .map((t) => ({
        position: oneOf(TIRE_POSITIONS, t.position, "FL"),
        dot: t.dot,
        producedYear: t.producedYear,
        producedWeek: t.producedWeek,
        treadDepthMm: t.treadDepthMm,
        condition: oneOf(TIRE_CONDITIONS, t.condition, "good"),
      })),
    createdAt: iso(s.createdAt),
    updatedAt: iso(s.updatedAt),
  }),
  list: {
    filters: z.strictObject({ vehicleId: ref.optional(), status: z.enum(TIRE_SET_STATUSES).optional(), season: z.enum(TIRE_SEASONS).optional() }),
    where: ({ vehicleId, status, season }) => ({ ...(vehicleId ? { vehicleId } : {}), ...(status ? { status } : {}), ...(season ? { season } : {}) }),
    sorts: { storedAt: (dir) => ({ storedAt: dir }), season: (dir) => ({ season: dir }), createdAt: (dir) => ({ createdAt: dir }), updatedAt: (dir) => ({ updatedAt: dir }) },
    defaultSort: [{ key: "storedAt", dir: "desc" }],
  },
  create: { permission: "tires.create", operation: createTireSetOperation, body, toInput, rename: tireField },
  update: {
    permission: "tires.edit",
    operation: updateTireSetOperation,
    current: (s) => ({
      vehicleId: s.vehicleId,
      season: s.season,
      status: s.status,
      brand: s.brand,
      model: s.model,
      width: s.width,
      aspect: s.aspect,
      rim: s.rim,
      loadIndex: s.loadIndex,
      speedIndex: s.speedIndex,
      rimType: s.rimType,
      storageLocation: s.storageLocation,
      storedAt: day(s.storedAt),
      notes: s.notes,
      spare: s.tires.some((t) => t.position === "SPARE"),
      tires: Object.fromEntries(s.tires.map((t) => [t.position, { dot: t.dot, treadDepthMm: t.treadDepthMm, condition: t.condition }])),
    }),
    toInput: (merged, { id, version }) => ({ ...toInput(merged), id, version }),
    rename: tireField,
  },
  remove: { permission: "tires.delete", operation: deleteTireSetOperation },
  actions: [
    {
      name: "status",
      summary: "Set the status of a tire set (stored, mounted, disposed)",
      permission: "tires.edit",
      operation: setStatusOperation,
      body: z.strictObject({ status: z.enum(TIRE_SET_STATUSES) }),
      toInput: (id, b) => ({ id, status: b.status }),
    },
  ],
});

/** Feldnamen der Operation (`tire.FL.dot`) → API (`tires.FL.dot`, `…treadDepthMm`). */
function tireField(name: string): string {
  const m = /^tire\.(\w+)\.(dot|tread)$/.exec(name);
  return m ? `tires.${m[1]}.${m[2] === "tread" ? "treadDepthMm" : "dot"}` : name;
}
