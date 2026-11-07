import { Card } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { splitBytes } from "@/lib/bytes";
import type { SectionDef, SectionProps } from "@/modules/types";
import { orderRef } from "@/modules/workshop/orders/public";
import { vehicleRef } from "@/modules/workshop/vehicles/public";
import { FileGallery, type FileItem } from "./file-gallery";
import { filesOf } from "./queries";
import type { FileOwnerType } from "./constants";

/**
 * Beitrag zur Fahrzeug- und zur Auftragsseite: „Dokumente & Fotos“ mit Galerie, Upload (mit `files.upload`, nicht an einem archivierten Fahrzeug oder abgeschlossenen Auftrag) und Entfernen.
 * Fahrzeug und Auftrag kennen den Abschnitt nicht; er hängt sich über den Erweiterungspunkt ein. Bei einem Kunden mit eingeschränkter Verarbeitung (Art. 18) erscheint er gar nicht.
 */
async function FilesSection({ entityId, session, type }: SectionProps & { type: FileOwnerType }) {
  const [{ t, date, number }, files] = await Promise.all([getI18n(), filesOf(session, { type, id: entityId })]);
  let open: boolean;
  if (type === "order") {
    const ref = await orderRef(entityId);
    if (!ref || ref.restricted) return null;
    open = ref.open;
  } else {
    const ref = await vehicleRef(entityId);
    if (!ref || ref.restricted) return null;
    open = !ref.archived;
  }
  const size = (bytes: number) => {
    const { value, unit } = splitBytes(bytes);
    return `${number(value, { maximumFractionDigits: unit === "B" || unit === "KB" ? 0 : 1 })} ${unit}`;
  };
  const items: FileItem[] = files.map((f) => ({
    id: f.id,
    name: f.name,
    caption: f.caption,
    category: f.category,
    isImage: f.isImage,
    sizeLabel: size(f.size),
    version: f.version,
    mayChange: f.mayChange,
    uploadedByName: f.uploadedByName,
    createdLabel: date(f.createdAt, { dateStyle: "medium", timeStyle: "short" }),
  }));
  return (
    <Card title={t("files.section.title")}>
      <p className="mb-4 text-sm text-ink-muted">{type === "order" ? t("files.section.introOrder") : t("files.section.introVehicle")}</p>
      {!open ? <p className="mb-4 text-sm text-ink-muted">{type === "order" ? t("files.section.orderClosed") : t("files.section.vehicleArchived")}</p> : null}
      <FileGallery ownerType={type} ownerId={entityId} files={items} canUpload={open && session.can("files.upload")} />
    </Card>
  );
}

export const sections: SectionDef[] = [
  { id: "files-order", feature: "workshop.files", host: "orders/detail", permission: "files.view", order: 40, uses: ["workshop.orders"], Component: (props) => <FilesSection {...props} type="order" /> },
  { id: "files-vehicle", feature: "workshop.files", host: "vehicles/detail", permission: "files.view", order: 40, Component: (props) => <FilesSection {...props} type="vehicle" /> },
];
