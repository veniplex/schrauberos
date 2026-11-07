import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { SubmitButton } from "@/components/ui/buttons";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { DangerZone } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { nonZero, type Dependency } from "@/lib/archive-filter";

type FormAction = (formData: FormData) => Promise<void>;

/**
 * Löschschutz und Archiv eines Datensatzes (P4b-2) für die Detailseiten von Kunden und Fahrzeugen: zeigt **vor** dem Löschen oder Archivieren, was daran hängt (Zählung), bietet
 * Archivieren bzw. Wiederaktivieren an und das Löschen nur, wenn nichts mehr daran hängt (`deletable`) – sonst steht der Weg „archivieren“ da statt einer Sackgasse.
 * Die Aktionen prüfen ihr Recht selbst; `canArchive`/`canDelete` blenden die Knöpfe nur aus.
 */
export async function ArchivePanel({
  id,
  archived,
  deps,
  canArchive,
  canDelete,
  deletable,
  archive,
  unarchive,
  remove,
  deleteLabel,
  confirmDelete,
  confirmArchive,
  notes,
}: {
  id: string;
  archived: boolean;
  deps: readonly Dependency[];
  canArchive: boolean;
  canDelete: boolean;
  deletable: boolean;
  archive: FormAction;
  unarchive: FormAction;
  remove: FormAction;
  deleteLabel: string;
  confirmDelete: string;
  /** Text vor dem Archivieren, Standard: der allgemeine */
  confirmArchive?: string;
  /** Zusätzliche Hinweise unter der Zählung (z. B. offene Termine) */
  notes?: readonly string[];
}) {
  if (!canArchive && !canDelete) return null;
  const { t, tp } = await getI18n();
  const listed = nonZero(deps);
  return (
    <DangerZone title={t("common.dangerZone")}>
      <div className="flex flex-col gap-3 text-sm">
        <div>
          <p className="font-medium">{t("archive.deps.title")}</p>
          {listed.length === 0 ? (
            <p className="text-ink-muted">{t("archive.deps.none")}</p>
          ) : (
            <ul className="list-disc pl-5 text-ink-muted">
              {listed.map((d) => (
                <li key={d.kind}>{tp(`archive.deps.${d.kind}` as "archive.deps.vehicles", d.count)}</li>
              ))}
            </ul>
          )}
          {(notes ?? []).map((note) => (
            <p key={note} className="mt-1 text-ink-muted">
              {note}
            </p>
          ))}
        </div>
        {archived ? <p className="text-ink-muted">{t("archive.notice")}</p> : null}
        <div className="flex flex-wrap gap-2">
          {canArchive ? (
            archived ? (
              <form action={unarchive}>
                <input type="hidden" name="id" value={id} />
                <SubmitButton variant="secondary" size="sm">
                  <ArchiveRestore className="size-4" aria-hidden /> {t("archive.action.unarchive")}
                </SubmitButton>
              </form>
            ) : (
              <form action={archive}>
                <input type="hidden" name="id" value={id} />
                <ConfirmSubmitButton variant="secondary" message={confirmArchive ?? t("archive.confirmArchive")} confirmLabel={t("archive.action.archive")}>
                  <Archive className="size-4" aria-hidden /> {t("archive.action.archive")}
                </ConfirmSubmitButton>
              </form>
            )
          ) : null}
          {canDelete && deletable ? (
            <form action={remove}>
              <input type="hidden" name="id" value={id} />
              <ConfirmSubmitButton message={confirmDelete}>
                <Trash2 className="size-4" aria-hidden /> {deleteLabel}
              </ConfirmSubmitButton>
            </form>
          ) : null}
        </div>
        {canDelete && !deletable ? <p className="text-ink-muted">{t("archive.hintDelete")}</p> : null}
      </div>
    </DangerZone>
  );
}
