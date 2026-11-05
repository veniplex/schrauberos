import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { createPrismaClient } from "./db-client";

const globalForDb = globalThis as unknown as { __db?: PrismaClient };

export const db = globalForDb.__db ?? createPrismaClient();
if (process.env.NODE_ENV !== "production") globalForDb.__db = db;
