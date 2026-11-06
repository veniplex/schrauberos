import "server-only";
import { cache } from "react";
import { db } from "@/server/db";

/** Kalender-Raster (Singleton-Zeile, wird beim ersten Zugriff mit Standardwerten angelegt). */
export const getAppointmentSettings = cache(async () => db.appointmentSettings.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } }));
