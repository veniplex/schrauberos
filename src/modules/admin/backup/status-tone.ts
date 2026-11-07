import type { StatusTone } from "@/lib/status-tone";
import type { BackupKind } from "@/server/backup/kinds";

export const BACKUP_KIND_TONE: Record<BackupKind, StatusTone> = { auto: "info", manual: "accent", upload: "neutral", "pre-update": "warning", "pre-restore": "warning", "pre-migration": "warning" };
