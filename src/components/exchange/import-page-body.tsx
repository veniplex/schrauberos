import { getI18n } from "@/i18n/server";
import type { MessageKey } from "@/i18n/translate";
import { ImportPanel } from "./import-panel";

/** Inhalt einer Importseite: erwartete Spalten (Beschriftungen in der Sprache der Person) und das Formular. `rules`: Regeln dieser Datenart (Pflichtfelder, Dubletten). */
export async function ImportPageBody({
  kind,
  duplicateOverride,
  columns,
  rules,
}: {
  kind: string;
  duplicateOverride: boolean;
  columns: ReadonlyArray<{ labelKey: MessageKey; required?: boolean }>;
  rules: MessageKey;
}) {
  const { t } = await getI18n();
  return (
    <ImportPanel kind={kind} duplicateOverride={duplicateOverride} columns={columns.map((c) => ({ label: t(c.labelKey), required: !!c.required }))} rules={t(rules)} />
  );
}
