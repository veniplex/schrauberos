import "server-only";
import type { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { AuditAction } from "@/lib/audit-actions";
import { logError } from "@/lib/log-safe";
import type { Permission } from "@/modules/catalog";
import type { AppSession } from "@/server/auth/session";
import { writeAudit } from "@/server/audit";
import { db } from "@/server/db";
import { writeOutboxEvent } from "@/server/outbox";
import { fieldErrors, mapPrismaError, OperationError, type OperationFailure } from "./errors";
import { runOperationHooks } from "./hooks";

/**
 * Der transportneutrale Kern jeder schreibenden Operation (Aktions-Rahmen, P1a-5).
 *
 *   defineOperation({ name, permission, input, audit, run })
 *
 * wird von zwei Adaptern aufgerufen: `defineAction` (Server Action: FormData, Cookie-Sitzung, Flash/`redirect`) und `defineApi`
 * (HTTP: JSON, Bearer-Token, Statuscodes). **`run` kennt weder `redirect` noch Flash noch Übersetzung**; es arbeitet auf geprüfter
 * Eingabe, wirft bei Fachfehlern `OperationError` (`fail(...)`) und gibt Daten zurück. Der Kern erledigt in dieser Reihenfolge:
 *
 *  1. Recht prüfen (`permission` ist Pflicht und hat keinen Standard; `"authenticated"` = jede angemeldete Person, bewusst ausgeschrieben),
 *  2. Eingabe prüfen (Zod; Feldfehler als Meldungsschlüssel),
 *  3. `prepare` (aufwendige Vorarbeit **außerhalb** der Transaktion: Passwort-Hash, Datei ablegen),
 *  4. in **einer Transaktion**: `run`, synchrone Hooks anderer Funktionen, Audit-Eintrag (keine Änderung ohne Eintrag),
 *  5. nach dem Commit: `afterCommit`-Aufgaben; bei Fehler `onFailure` (z. B. Audit eines Fehlschlags) und `finish` (Aufräumen).
 *
 * Datenbankfehler P2002/P2025/P2003 werden zu den Fehlern `duplicate`/`notFound`/`inUse`. Ereignisse für Webhooks entstehen nur hier
 * (`ctx.emit` → Outbox, in derselben Transaktion).
 */

export type Tx = Prisma.TransactionClient;
export type Principal = AppSession;

/** Erforderliches Recht; `"authenticated"`: jede angemeldete Person (z. B. Konto, Einstellungen der eigenen Person). */
export type PermissionRequirement = Permission | "authenticated";

export type AuditDetails = { target?: string | null; entityId?: string | null };

export type RunContext<I, P> = {
  /** Name der Operation */
  name: string;
  input: I;
  principal: Principal;
  /** Ergebnis von `prepare` */
  prepared: P;
  /** Transaktion (bei `transaction: false` der normale Client) */
  tx: Tx;
  /** Ereignis in die Outbox schreiben – in derselben Transaktion, also erst nach dem Commit für den Runner sichtbar */
  emit(type: string, payload?: Record<string, unknown>, entityId?: string | null): Promise<void>;
  /** Betroffenes Objekt für den Audit-Eintrag festhalten (lesbare Bezeichnung und ID) */
  audit(details: AuditDetails): void;
  /** Aufgabe nach erfolgreichem Commit (Datei löschen, Neustart anstoßen …); Fehler werden nur protokolliert */
  afterCommit(task: () => unknown): void;
};

type AuditOption<I, R> =
  | {
      /** Audit-Aktion (aus `src/lib/audit-actions.ts`), oder eine Funktion, die sie aus Eingabe und Ergebnis wählt */
      audit: AuditAction | ((input: I, result: R) => AuditAction);
      auditReason?: undefined;
    }
  | {
      /** Bewusst kein Audit – dann ist eine Begründung Pflicht (steht im Code und fällt im Review auf) */
      audit: false;
      auditReason: string;
    };

export type OperationDef<S extends z.ZodType, R, P> = {
  /** Eindeutiger Name, z. B. "invoices.markPaid" (Protokoll, Hooks, Berechtigungs-Matrix) */
  name: string;
  /** Pflicht, kein Standard */
  permission: PermissionRequirement;
  /** Eingabeschema der Sache (nicht des Formulars: Formular- und API-Eingaben werden vom Adapter in diese Form gebracht) */
  input: S;
  /** Vorarbeit außerhalb der Transaktion (Hash berechnen, Datei speichern). Darf `OperationError` werfen. */
  prepare?: (ctx: { input: z.output<S>; principal: Principal }) => Promise<P>;
  run: (ctx: RunContext<z.output<S>, P>) => Promise<R>;
  /** Nach Abschluss (auch bei Fehlern): `ok` sagt, ob die Operation festgeschrieben wurde – z. B. eine vorab gespeicherte Datei wieder entfernen */
  finish?: (prepared: P, ok: boolean) => Promise<void> | void;
  /** Nach einem Fehler (außerhalb der zurückgerollten Transaktion), z. B. um einen Fehlschlag ins Audit-Log zu schreiben */
  onFailure?: (info: { input: z.output<S>; principal: Principal; failure: OperationFailure | null }) => Promise<void> | void;
  /** Standard: true (eine Transaktion um run, Hooks und Audit). `false` für lange Vorgänge (Backup, Update); dann gibt es keine Hooks. */
  transaction?: boolean;
} & AuditOption<z.output<S>, R>;

/** Ergebnis: bei Erfolg Daten und die geprüfte Eingabe (für Ziele und Meldungen der Adapter), sonst der Fehler. */
export type Outcome<R, I = unknown> = { ok: true; data: R; input: I } | { ok: false; failure: OperationFailure };

export type Operation<I = unknown, R = unknown> = {
  readonly name: string;
  readonly permission: PermissionRequirement;
  readonly audited: boolean;
  /** Führt die Operation für `principal` mit roher Eingabe aus. Kennt keinen Transport. */
  execute(principal: Principal, raw: unknown): Promise<Outcome<R, I>>;
  /** Nur für Typen: Form der geprüften Eingabe */
  readonly _input?: I;
};

const registry = new Map<string, Operation>();

/** Alle bisher definierten Operationen (für die Berechtigungs-Matrix und Architekturtests). */
export function listOperations(): ReadonlyMap<string, Operation> {
  return registry;
}

const TX_OPTIONS = { maxWait: 5_000, timeout: 20_000 };

const failureOf = (error: unknown): OperationFailure | null => (error instanceof OperationError ? error.failure : mapPrismaError(error));

export function defineOperation<S extends z.ZodType, R, P = undefined>(def: OperationDef<S, R, P>): Operation<z.output<S>, R> {
  if (!def.permission) throw new Error(`Operation ${def.name}: permission ist Pflicht`);
  if (def.audit === false && !def.auditReason?.trim()) throw new Error(`Operation ${def.name}: audit: false braucht eine Begründung (auditReason)`);

  const operation: Operation<z.output<S>, R> = {
    name: def.name,
    permission: def.permission,
    audited: def.audit !== false,

    async execute(principal, raw) {
      if (def.permission !== "authenticated" && !principal.can(def.permission)) return { ok: false, failure: { code: "forbidden" } };

      const parsed = def.input.safeParse(raw);
      if (!parsed.success) return { ok: false, failure: { code: "invalid", fields: fieldErrors(parsed.error) } };
      const input = parsed.data as z.output<S>;

      let prepared = undefined as P;
      let committed = false;
      let outcome: Outcome<R, z.output<S>>;
      try {
        try {
          if (def.prepare) prepared = await def.prepare({ input, principal });
        } catch (error) {
          const failure = failureOf(error);
          if (!failure) throw error;
          outcome = { ok: false, failure };
          await settle(def, input, principal, outcome);
          return outcome;
        }

        const afterCommit: Array<() => unknown> = [];
        const body = async (tx: Tx): Promise<R> => {
          let details: AuditDetails = {};
          const data = await def.run({
            name: def.name,
            input,
            principal,
            prepared,
            tx,
            emit: async (type, payload, entityId) => {
              await writeOutboxEvent(tx, { type, payload, entityId: entityId ?? null, actorId: principal.user.id });
            },
            audit: (value) => {
              details = value;
            },
            afterCommit: (task) => void afterCommit.push(task),
          });
          if (def.transaction !== false) await runOperationHooks({ operation: def.name, input, result: data, principal, tx });
          if (def.audit !== false) {
            const action = typeof def.audit === "function" ? def.audit(input, data) : def.audit;
            await writeAudit(tx, action, { ...details, actor: { id: principal.user.id, name: principal.user.name } });
          }
          return data;
        };

        try {
          const data = def.transaction === false ? await body(db) : await db.$transaction(body, TX_OPTIONS);
          committed = true;
          outcome = { ok: true, data, input };
        } catch (error) {
          const failure = failureOf(error);
          if (!failure) throw error;
          outcome = { ok: false, failure };
        }

        if (outcome.ok) {
          for (const task of afterCommit) {
            try {
              await task();
            } catch (error) {
              logError(`${def.name}:afterCommit`, error);
            }
          }
        } else {
          await settle(def, input, principal, outcome);
        }
        return outcome;
      } finally {
        if (def.finish) {
          try {
            await def.finish(prepared, committed);
          } catch (error) {
            logError(`${def.name}:finish`, error);
          }
        }
      }
    },
  };

  registry.set(def.name, operation as Operation);
  return operation;
}

/** Fehlerfolgen außerhalb der zurückgerollten Transaktion (Audit eines Fehlschlags u. Ä.); Fehler darin werden nur protokolliert. */
async function settle<S extends z.ZodType, R, P>(def: OperationDef<S, R, P>, input: z.output<S>, principal: Principal, outcome: Outcome<R, z.output<S>>): Promise<void> {
  if (outcome.ok || !def.onFailure) return;
  try {
    await def.onFailure({ input, principal, failure: outcome.failure });
  } catch (error) {
    logError(`${def.name}:onFailure`, error);
  }
}
