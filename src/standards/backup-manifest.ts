import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

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
  last_success: string; // ISO 8601 UTC
}
export type BackupManifest = Record<string, BackupManifestEntry>;

function manifestPath(): string {
  return (
    process.env.MANIFEST_PATH ??
    process.env.BACKUP_MANIFEST_FILE ??
    join(homedir(), ".infraops", "vps-backup-manifest.json")
  );
}

/**
 * Load the coverage manifest. A missing or unreadable manifest is not an error:
 * it yields an empty map so every running DB reads as uncovered and the audit
 * still runs (fail-closed for the assertion, fail-open for the audit itself).
 */
export async function loadBackupManifest(): Promise<BackupManifest> {
  try {
    const parsed = JSON.parse(await readFile(manifestPath(), "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as BackupManifest) : {};
  } catch {
    return {};
  }
}

const FRESH_MS = 24 * 60 * 60 * 1000;

/**
 * Attach synthetic coverage fields to a coolify_database resource so the
 * declarative check-engine can assert on them:
 *   - backup_covered: the DB's UUID is present in the manifest
 *   - backup_fresh:   its last successful backup is within 24h
 */
export function enrichWithBackupCoverage(
  db: Record<string, unknown>,
  manifest: BackupManifest,
  now: number,
): void {
  const uuid = String(db.uuid ?? "");
  const entry = uuid ? manifest[uuid] : undefined;
  db.backup_covered = Boolean(entry);
  let fresh = false;
  if (entry?.last_success) {
    const t = Date.parse(entry.last_success);
    fresh = Number.isFinite(t) && now - t <= FRESH_MS;
  }
  db.backup_fresh = fresh;
}
