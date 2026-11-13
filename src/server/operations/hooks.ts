import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { AppSession } from "@/server/auth/session";
import type { FeatureId } from "@/modules/catalog";
import { operationHooks as registered } from "@/modules/operation-hooks";

/**
 * Transaktionale Hooks: Eine Funktion meldet sich in `src/modules/operation-hooks.ts` (`operationHooks`) für eine Operation
 * einer anderen Funktion an (z. B. „Auftrag abschließen“) und läuft **synchron in derselben Transaktion**. Die auslösende Funktion kennt
 * ihre Abonnenten nicht. Wirft ein Hook, wird die gesamte Operation zurückgerollt (er kann sie also auch verhindern, mit einem
 * `OperationError`). Asynchrone Wirkungen (Webhooks, Mail) gehören nicht hierher, sondern in die Outbox (`ctx.emit`).
 */
export type OperationHookContext = {
  /** Name der Operation, z. B. "invoices.markPaid" */
  operation: string;
  input: unknown;
  result: unknown;
  principal: AppSession;
  tx: Prisma.TransactionClient;
  /** Aufgabe, wenn die Transaktion (der Operation, nicht nur des Hooks) zurückgerollt wird, z. B. eine in der Transaktion abgelegte Datei wieder entfernen */
  onRollback?: (task: () => unknown) => void;
};

export type OperationHookDef = {
  /** Name der Operation, auf die der Hook reagiert */
  operation: string;
  /** Funktion, der der Hook gehört: läuft nur, wenn sie aktiv ist (außer `always`) */
  feature: FeatureId;
  /**
   * Läuft auch bei **ausgeschalteter** Funktion. Nur für Hooks, die Bestandsdaten der Funktion bereinigen oder abgleichen (Anonymisierung `customers.anonymize`, Markierungen übernommener Zeiten): Die Daten bleiben bei
   * ausgeschalteter Funktion in der Datenbank und kämen beim Wiedereinschalten zurück. Fachliche Folgehooks (Status, Lager …) gehören nie hierher.
   */
  always?: boolean;
  run: (ctx: OperationHookContext) => Promise<void> | void;
};

let override: readonly OperationHookDef[] | null = null;

/** Nur für Tests: ersetzt die eingetragenen Hooks (`null` = zurück zu den eingetragenen). */
export function setOperationHooksForTest(hooks: readonly OperationHookDef[] | null): void {
  override = hooks;
}

export async function runOperationHooks(ctx: OperationHookContext): Promise<void> {
  for (const hook of override ?? registered) {
    if (hook.operation === ctx.operation && (hook.always || ctx.principal.features.has(hook.feature))) await hook.run(ctx);
  }
}
