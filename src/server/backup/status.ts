/**
 * Warnt das Backup? Das automatische Backup (Job `backup.auto`) ist in einer Fehlerserie – **es sei denn**, nach dem letzten fehlgeschlagenen Versuch ist ein Backup
 * (gleich welcher Art, auch von Hand) entstanden: Dann besteht wieder Schutz, und die Warnung wäre veraltet. Rein, ohne Datenbank- und Dateizugriff.
 */
export function autoBackupFailing(job: { failures: number; lastRunAt: Date | null } | null, newestBackupAt: Date | null): boolean {
  if (!job || job.failures <= 0) return false;
  return !(newestBackupAt && job.lastRunAt && newestBackupAt.getTime() > job.lastRunAt.getTime());
}
