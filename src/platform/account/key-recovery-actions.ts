"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/ui/form";
import { getI18n } from "@/i18n/server";
import { reconstructSecretKey } from "@/server/secret-key-recovery";

/**
 * Schlüssel wiederherstellen (öffentlich, vor der Anmeldung – Konten mit zweitem Faktor kommen ohne `secret.key` nicht hinein): rekonstruiert `secret.key` aus der Hülle in der
 * Datenbank. Die Wirkung gibt es nur in einem Störungsfall und nur mit dem 256-Bit-Wiederherstellungsschlüssel; die Eingabe ist global gedrosselt (siehe `secret-key-recovery.ts`).
 * Die Meldungen unterscheiden Tippfehler, falschen Schlüssel und „nicht nötig“, verraten sonst nichts.
 */
export async function reconstructKey(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { t } = await getI18n();
  const result = await reconstructSecretKey(String(formData.get("key") ?? "").slice(0, 200));
  if (!result.ok) {
    const messages = {
      notNeeded: t("backup.keyIssue.notNeeded"),
      noWrappedKey: t("backup.keyIssue.errors.noWrappedKey"),
      format: t("backup.keyIssue.errors.format"),
      wrong: t("backup.keyIssue.errors.wrong"),
      unwritable: t("backup.keyIssue.errors.unwritable"),
    } as const;
    return { error: messages[result.reason] };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: t("backup.keyIssue.done") };
}
