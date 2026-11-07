import { getI18n } from "@/i18n/server";
import { LABEL_FORMATS, MAX_LABEL_COPIES, labelsPerPage, type LabelFormat } from "@/lib/labels";
import { Button } from "./buttons";
import { Field, Input, Select } from "./form-fields";
import { Card } from "./layout";

/**
 * Auswahl für den Etikettendruck (F8): Format, Anzahl und – nur für den A4-Bogen – die schon benutzten Felder. Ein einfaches GET-Formular (die Seite zeigt danach die Vorschau; nichts wird
 * gespeichert): Die Auswahl steht in der Adresse und lässt sich so auch als Lesezeichen am Etikettendrucker-Rechner halten. Die Texte stammen von der Funktion, die druckt, nur `copiesHint` ist ihr eigener.
 */
export async function LabelOptions({ format, copies, skip, copiesHint }: { format: LabelFormat; copies: number; skip: number; copiesHint?: string }) {
  const { t } = await getI18n();
  return (
    <Card>
      <form method="get" className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start">
        <Field label={t("ui.print.format")} htmlFor="label-format">
          <Select id="label-format" name="format" defaultValue={format}>
            {LABEL_FORMATS.map((f) => (
              <option key={f} value={f}>
                {t(`ui.print.formats.${f}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("ui.print.copies")} htmlFor="label-copies" hint={copiesHint}>
          <Input id="label-copies" name="copies" type="number" inputMode="numeric" min={1} max={MAX_LABEL_COPIES} defaultValue={copies} />
        </Field>
        <Field label={t("ui.print.skip")} htmlFor="label-skip" hint={t("ui.print.skipHint")}>
          <Input id="label-skip" name="skip" type="number" inputMode="numeric" min={0} max={labelsPerPage("sheet-3x8") - 1} defaultValue={skip} />
        </Field>
        <Button type="submit" variant="secondary" className="sm:mt-6">
          {t("ui.print.apply")}
        </Button>
      </form>
    </Card>
  );
}
