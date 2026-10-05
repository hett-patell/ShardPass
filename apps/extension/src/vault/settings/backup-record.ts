/**
 * When the last encrypted backup file was saved from this profile. Not a secret -- a date --
 * so it is kept where the vault page reads it without unlocking anything. Plain exports
 * (JSON, CSV) do not count: they are not a backup this vault can safely be restored from.
 */
const LAST_BACKUP_KEY = "shardpass:backup:lastEncryptedAt";

/** Days after which the dashboard says a backup is overdue rather than merely worth having. */
export const BACKUP_STALE_DAYS = 30;

export function lastBackupAt(): number | null {
  try {
    const stored = Number(globalThis.localStorage?.getItem(LAST_BACKUP_KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : null;
  } catch {
    return null;
  }
}

export function recordBackup(at: number = Date.now()): void {
  try {
    globalThis.localStorage?.setItem(LAST_BACKUP_KEY, String(at));
  } catch {
    // Not remembering the date only means the reminder cannot say how old the backup is.
  }
}
