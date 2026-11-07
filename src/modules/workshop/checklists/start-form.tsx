"use client";

import { Field, Form, FormActions, Select } from "@/components/ui/form";
import { Card, Plate } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import { VehiclePicker, type VehicleOption } from "@/modules/workshop/vehicles/client";
import { startChecklist } from "./actions";

/**
 * Checkliste beginnen: Vorlage wählen und Fahrzeug (Auswahlfeld) bzw. – wenn die Seite mit `?order=` geöffnet wurde – den Auftrag (das Fahrzeug ergibt sich daraus). Der Server prüft Rechte, Archiv, offenen Auftrag
 * und Art. 18 noch einmal.
 */
export function StartForm({
  templates,
  vehicle,
  order,
  selectedTemplate,
  canCreateVehicle,
}: {
  templates: Array<{ id: string; name: string }>;
  vehicle: VehicleOption | null;
  order: { id: string; number: string; plate: string } | null;
  selectedTemplate?: string;
  canCreateVehicle: boolean;
}) {
  const { t } = useI18n();
  return (
    <Form action={startChecklist} draftKey="checklist-new" className="flex flex-col gap-5">
      <Card title={t("checklists.new.title")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("checklists.new.template")} htmlFor="templateId" name="templateId" required>
            <Select id="templateId" name="templateId" defaultValue={selectedTemplate ?? templates[0]?.id ?? ""}>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </Select>
          </Field>
          {order ? (
            <Field label={t("checklists.detail.order")} name="orderId">
              <input type="hidden" name="orderId" value={order.id} />
              <p className="flex items-center gap-2 py-2 text-sm">
                <Plate>{order.plate}</Plate>
                <span className="tabular">{order.number}</span>
              </p>
            </Field>
          ) : (
            <Field label={t("checklists.new.vehicle")} name="vehicleId" required>
              <VehiclePicker initial={vehicle} canCreate={canCreateVehicle} required />
            </Field>
          )}
        </div>
      </Card>
      <FormActions cancelHref="/checklists" submitLabel={t("checklists.new.start")} />
    </Form>
  );
}
