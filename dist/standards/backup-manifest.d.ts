/**
 * Backup coverage manifest emitted by ~/Projects/vps-backup/backup.sh.
 *
 * Maps a standalone Coolify database UUID → proof that it was successfully
 * dumped AND stored in restic on the most recent backup run. Presence means
 * "actually backed up", not "configured to be backed up" — a DB whose dump
 * failed is absent, so rule #572 will (correctly) flag it.
 *
 * vps-backup and this MCP server run on the same machine, so the manifest is
 * read as a local file (no network transport).
 */
export interface BackupManifestEntry {
    label: string;
    last_success: string;
}
export type BackupManifest = Record<string, BackupManifestEntry>;
/**
 * Load and MERGE the coverage manifests. A missing or unreadable manifest is not an
 * error: it contributes nothing, so a DB only reads as covered if some manifest
 * actually proves it (fail-closed for the assertion, fail-open for the audit itself).
 * Prod and dev DB UUIDs are disjoint keyspaces, so the merge order is immaterial.
 */
export declare function loadBackupManifest(): Promise<BackupManifest>;
/**
 * Attach synthetic coverage fields to a coolify_database resource so the
 * declarative check-engine can assert on them:
 *   - backup_covered: the DB's UUID is present in the manifest
 *   - backup_fresh:   its last successful backup is within 24h
 */
export declare function enrichWithBackupCoverage(db: Record<string, unknown>, manifest: BackupManifest, now: number): void;
//# sourceMappingURL=backup-manifest.d.ts.map