/**
 * Testharness: führt echte Server Actions, Seiten-Logik und Route Handler gegen eine echte, temporäre SQLite-Datenbank aus
 * (alle Migrationen wie im Betrieb angewendet) – ohne Next.js-Laufzeit.
 *
 * Aufbau eines Tests (Muster siehe `harness.test.ts`):
 *
 *   const env = await createTestEnv();                       // Datenbank, Fakes, Basisdaten
 *   const { saveUser } = await import("./actions");          // Code erst NACH createTestEnv laden
 *   const admin = await env.user({ username: "chef", roles: [adminRole] });
 *   await env.signIn(admin);                                 // Fake-Sitzung (echte Sitzungszeile, Cookie im Fake-Browser)
 *   const state = await saveUser({}, form({ ... }));         // Action wie vom Formular aufgerufen
 *   assert.equal(await redirectOf(() => saveUser(...)), "/admin/users?saved=…");
 *
 * Was ersetzt wird (nur Rand der Next.js-Laufzeit, nie die eigene Logik):
 *  - `server-only` → leer, `next/cache` → keine Wirkung (Aufrufe werden mitgeschrieben),
 *  - `next/navigation`: `redirect()`/`notFound()` werfen abfangbare Fehler (`RedirectSignal`/`NotFoundSignal`),
 *  - `next/headers`: `cookies()`/`headers()` lesen den Zustand des Fake-Browsers (`env.browser`).
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import Module from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient, type Role, type User } from "@/generated/prisma/client";
import { SESSION_COOKIE } from "@/lib/session-cookie";
import { runMigrations } from "@/server/migrate";

/* ───────────── Abfangbare Next.js-Signale ───────────── */

export class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`NEXT_REDIRECT ${url}`);
  }
}
export class NotFoundSignal extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
  }
}

/** Führt `fn` aus und liefert das Ziel einer Weiterleitung (`redirect()`), sonst null. Andere Fehler werden weitergereicht. */
export async function redirectOf(fn: () => unknown): Promise<string | null> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof RedirectSignal) return error.url;
    throw error;
  }
  return null;
}

/** Wirft `fn` `notFound()`? */
export async function isNotFound(fn: () => unknown): Promise<boolean> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof NotFoundSignal) return true;
    throw error;
  }
  return false;
}

/* ───────────── Fake-Browser: Cookies und Header ───────────── */

type CookieOptions = { secure?: boolean; httpOnly?: boolean; sameSite?: string; path?: string; expires?: Date; maxAge?: number };
export type CookieWrite = { name: string; value: string | null; options: CookieOptions };

/** Zustand des „Browsers“, aus dem `cookies()`/`headers()` lesen. Cookies bleiben zwischen Aufrufen erhalten (wie im Browser). */
export const browser = {
  cookies: new Map<string, string>(),
  headers: new Headers(),
  /** Alle Schreibzugriffe auf Cookies in der Reihenfolge (für Tests von Name, Secure-Flag …) */
  writes: [] as CookieWrite[],
  revalidated: [] as string[],
  /** Zurück auf „frischer Browser ohne Cookies, ohne Header“. */
  reset() {
    this.cookies.clear();
    this.headers = new Headers();
    this.writes.length = 0;
    this.revalidated.length = 0;
  },
  /** Setzt die Anfrage-Header (ersetzt die bisherigen), z. B. `{ "x-forwarded-for": "1.2.3.4" }`. */
  setHeaders(values: Record<string, string>) {
    this.headers = new Headers(values);
  },
};

function fakeCookieJar() {
  const entry = (name: string) => {
    const value = browser.cookies.get(name);
    return value === undefined ? undefined : { name, value };
  };
  return {
    get: entry,
    has: (name: string) => browser.cookies.has(name),
    getAll: () => [...browser.cookies].map(([name, value]) => ({ name, value })),
    set(nameOrOptions: string | ({ name: string; value: string } & CookieOptions), value?: string, options: CookieOptions = {}) {
      const [name, val, opts] = typeof nameOrOptions === "string" ? [nameOrOptions, value ?? "", options] : [nameOrOptions.name, nameOrOptions.value, nameOrOptions];
      browser.cookies.set(name, val);
      browser.writes.push({ name, value: val, options: opts });
    },
    delete(nameOrOptions: string | { name: string }) {
      const name = typeof nameOrOptions === "string" ? nameOrOptions : nameOrOptions.name;
      browser.cookies.delete(name);
      browser.writes.push({ name, value: null, options: {} });
    },
  };
}

/* ───────────── Fake-Module einhängen ───────────── */

const noop = () => undefined;
const FAKES: Record<string, unknown> = {
  "server-only": {},
  "next/headers": { __esModule: true, cookies: async () => fakeCookieJar(), headers: async () => browser.headers },
  "next/navigation": {
    __esModule: true,
    redirect: (url: string): never => {
      throw new RedirectSignal(url);
    },
    permanentRedirect: (url: string): never => {
      throw new RedirectSignal(url);
    },
    notFound: (): never => {
      throw new NotFoundSignal();
    },
  },
  "next/cache": {
    __esModule: true,
    revalidatePath: (p: string) => void browser.revalidated.push(p),
    revalidateTag: (tag: string) => void browser.revalidated.push(`tag:${tag}`),
    refresh: noop,
    updateTag: noop,
    unstable_noStore: noop,
  },
};

type ModuleInternals = { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
let installed = false;

/** Hängt die Fakes ein (einmal je Prozess). Muss vor dem ersten Import von Code geschehen, der `next/*` benutzt. */
export function installFakes(): void {
  if (installed) return;
  installed = true;
  const internals = Module as unknown as ModuleInternals;
  const original = internals._load;
  internals._load = function (request, parent, isMain) {
    return Object.hasOwn(FAKES, request) ? FAKES[request] : original.call(this, request, parent, isMain);
  };
}

/* ───────────── Formulardaten ───────────── */

export type FormValue = string | number | boolean | File | null | undefined | ReadonlyArray<string | number>;

/**
 * Baut `FormData` wie ein Browser: `true` → "on" (Checkbox), `false`/`null`/`undefined` → Feld fehlt, Listen → mehrere Einträge
 * unter demselben Namen (z. B. `roleId`, `permission`).
 */
export function form(values: Record<string, FormValue>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === false) continue;
    if (value === true) fd.append(key, "on");
    else if (Array.isArray(value)) for (const v of value) fd.append(key, String(v));
    else if (value instanceof File) fd.append(key, value);
    else fd.append(key, String(value));
  }
  return fd;
}

/* ───────────── Testumgebung ───────────── */

type RoleInput = { key?: string; name?: string; isAdmin?: boolean; isSystem?: boolean; permissions?: readonly string[] };
type UserInput = { username: string; name?: string; password?: string; active?: boolean; mustChangePassword?: boolean; roles?: ReadonlyArray<{ id: string }> };

export type TestEnv = {
  db: PrismaClient;
  dir: string;
  browser: typeof browser;
  /** Legt eine Rolle an (Administrator-Rolle: `isAdmin: true`). */
  role(input?: RoleInput): Promise<Role>;
  /** Legt einen Benutzer an; mit `password` wird ein echter Hash hinterlegt. */
  user(input: UserInput): Promise<User>;
  /** Meldet den Benutzer im Fake-Browser an: echte Sitzungszeile in der Datenbank + Sitzungs-Cookie. */
  signIn(user: { id: string }): Promise<void>;
  signOut(): void;
  /** Datenbank leeren (Benutzer, Rollen, Sitzungen …), z. B. zwischen Testfällen. */
  cleanup(): Promise<void>;
};

let counter = 0;

/**
 * Legt eine frische temporäre Datenbank an (alle Migrationen), macht sie zur Datenbank der Anwendung (`@/server/db`)
 * und hängt die Fakes ein. Danach den zu testenden Code mit `await import(...)` laden.
 */
export async function createTestEnv(): Promise<TestEnv> {
  installFakes();
  const dir = mkdtempSync(path.join(tmpdir(), "so-test-"));
  const file = path.join(dir, "test.db");
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `file:${file}`;
  await runMigrations(file);
  const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${file}` }) });
  (globalThis as unknown as { __db?: PrismaClient }).__db = db;
  browser.reset();

  return {
    db,
    dir,
    browser,
    role: (input = {}) => {
      const n = ++counter;
      return db.role.create({
        data: {
          key: input.key ?? `role-${n}`,
          name: input.name ?? `Rolle ${n}`,
          isAdmin: input.isAdmin ?? false,
          isSystem: input.isSystem ?? false,
          permissions: { create: (input.permissions ?? []).map((permission) => ({ permission })) },
        },
      });
    },
    user: async (input) => {
      const passwordHash = input.password ? await (await import("@/server/auth/password")).hashPassword(input.password) : null;
      return db.user.create({
        data: {
          username: input.username,
          name: input.name ?? input.username,
          passwordHash,
          active: input.active ?? true,
          mustChangePassword: input.mustChangePassword ?? false,
          roles: { create: (input.roles ?? []).map((r) => ({ roleId: r.id })) },
        },
      });
    },
    signIn: async (user) => {
      const token = randomBytes(32).toString("base64url");
      await db.session.create({
        data: { tokenHash: createHash("sha256").update(token).digest("hex"), userId: user.id, expiresAt: new Date(Date.now() + 86_400_000) },
      });
      browser.cookies.set(SESSION_COOKIE, token);
    },
    signOut: () => void browser.cookies.delete(SESSION_COOKIE),
    cleanup: async () => {
      await db.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Kurzform für Prüfungen auf Fehlerzustände der Aktionen. */
export function assertError(state: { error?: string; fieldErrors?: Record<string, string> }, message?: string): void {
  assert.ok(state.error || (state.fieldErrors && Object.keys(state.fieldErrors).length), message ?? "Fehlerzustand erwartet");
}
