import { notFound } from "next/navigation";
import { UrlModal } from "@/components/ui/modal";
import { getI18n } from "@/i18n/server";
import { db } from "@/server/db";
import { getSession } from "@/server/auth/session";
import { getAppointmentSettings } from "./settings";
import { toDateInput, toTimeInput } from "@/lib/dates";
import { formatTireSize } from "@/modules/workshop/tires/public";
import { toVehicleOption } from "@/modules/workshop/vehicles/public";
import { AppointmentForm, type AppointmentFormInitial } from "./appointment-form";
import { appointmentFormOptions } from "./queries";
import { versionOf } from "@/lib/concurrency";
import { customerDisplayName, customerNameSelect } from "@/modules/workshop/customers/public";

const toOption = toVehicleOption;

export type ModalParams = { edit?: string; at?: string; bay?: string; tireSet?: string; vehicle?: string; date: string };

export async function AppointmentModal({
  params,
  closeHref,
  canDelete,
}: {
  params: ModalParams;
  closeHref: string;
  canDelete: boolean;
}) {
  const session = await getSession();
  const current = params.edit ? await db.appointment.findUnique({ where: { id: params.edit }, select: { assigneeId: true, typeId: true, bayId: true } }) : null;
  const [{ t }, settings, options] = await Promise.all([
    getI18n(),
    getAppointmentSettings(),
    // „Zuständig“: Mitarbeiter statt aller Benutzerkonten, wenn die Funktion Mitarbeiter aktiv ist (weiche Abhängigkeit)
    appointmentFormOptions({ employees: session?.features.has("office.employees") ?? false, assigneeId: current?.assigneeId, typeId: current?.typeId, bayId: current?.bayId }),
  ]);

  let initial: AppointmentFormInitial;

  if (params.edit) {
    const a = await db.appointment.findUnique({
      where: { id: params.edit },
      include: { vehicle: { include: { customer: { select: customerNameSelect } } }, customer: { select: customerNameSelect }, tireSet: { include: { vehicle: true } } },
    });
    if (!a) notFound();
    initial = {
      id: a.id,
      version: versionOf(a),
      title: a.title,
      typeId: a.typeId ?? "",
      bayId: a.bayId ?? "",
      assigneeId: a.assigneeId ?? "",
      vehicle: a.vehicle ? toOption(a.vehicle) : null,
      customer: a.customer ? { id: a.customer.id, label: customerDisplayName(a.customer) } : null,
      tireSet: a.tireSet
        ? { id: a.tireSet.id, label: `${a.tireSet.vehicle.plate} · ${[a.tireSet.brand, formatTireSize(a.tireSet)].filter(Boolean).join(" ")}` }
        : null,
      date: toDateInput(a.startsAt),
      time: toTimeInput(a.startsAt),
      duration: Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60_000),
      status: a.status,
      notes: a.notes ?? "",
    };
  } else {
    const at = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(params.at ?? "") ? params.at! : null;
    const tireSet = params.tireSet
      ? await db.tireSet.findUnique({ where: { id: params.tireSet }, include: { vehicle: { include: { customer: { select: customerNameSelect } } } } })
      : null;
    const vehicle = tireSet?.vehicle
      ? tireSet.vehicle
      : params.vehicle
        ? await db.vehicle.findUnique({ where: { id: params.vehicle }, include: { customer: { select: customerNameSelect } } })
        : null;
    const type = tireSet ? options.types.find((x) => x.kind === "tire_change") : undefined;

    initial = {
      title: type?.name ?? "",
      typeId: type?.id ?? "",
      bayId: params.bay ?? "",
      assigneeId: "",
      vehicle: vehicle ? toOption(vehicle) : null,
      customer: null,
      tireSet: tireSet
        ? { id: tireSet.id, label: `${tireSet.vehicle.plate} · ${[tireSet.brand, formatTireSize(tireSet)].filter(Boolean).join(" ")}` }
        : null,
      date: at ? at.slice(0, 10) : params.date,
      time: at ? at.slice(11) : `${String(settings.dayStartHour).padStart(2, "0")}:00`,
      duration: type?.defaultMinutes ?? 60,
      status: "scheduled",
      notes: "",
    };
  }

  return (
    <UrlModal title={params.edit ? t("appointments.edit") : t("appointments.new")} closeHref={closeHref}>
      <AppointmentForm
        initial={initial}
        options={{
          types: options.types.map((x) => ({ id: x.id, name: x.name, defaultMinutes: x.defaultMinutes })),
          bays: options.bays.map((b) => ({ id: b.id, name: b.name })),
          users: options.users,
        }}
        returnTo={closeHref}
        closeHref={closeHref}
        canDelete={canDelete}
        canCreateVehicle={session?.can("vehicles.edit") ?? false}
      />
    </UrlModal>
  );
}
