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

/**
 * The manifest files to load and merge. There are two backup runners on this
 * machine that each emit a manifest of the DBs they proved-backed-up:
 *   - PROD (backup.sh)      → ~/.infraops/vps-backup-manifest.json
 *   - DEV  (backup-orb.sh)  → ~/.infraops/vps-backup-manifest-orb.json
 * The audit runs against BOTH Coolify instances, so it must consult both — without
 * the dev manifest, a dev DB that IS backed up (e.g. facelesstt) reads as uncovered
 * and rule #572 false-flags it. Each path is independently env-overridable for tests.
 */
function manifestPaths(): string[] {
  const dir = join(homedir(), ".infraops");
  const prod = process.env.MANIFEST_PATH ?? process.env.BACKUP_MANIFEST_FILE ?? join(dir, "vps-backup-manifest.json");
  const dev = process.env.BACKUP_MANIFEST_FILE_ORB ?? join(dir, "vps-backup-manifest-orb.json");
  return [prod, dev];
}

async function readOneManifest(path: string): Promise<BackupManifest> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as BackupManifest) : {};
  } catch {
    return {};
  }
}

/**
 * Load and MERGE the coverage manifests. A missing or unreadable manifest is not an
 * error: it contributes nothing, so a DB only reads as covered if some manifest
 * actually proves it (fail-closed for the assertion, fail-open for the audit itself).
 * Prod and dev DB UUIDs are disjoint keyspaces, so the merge order is immaterial.
 */
export async function loadBackupManifest(): Promise<BackupManifest> {
  const manifests = await Promise.all(manifestPaths().map(readOneManifest));
  return Object.assign({}, ...manifests);
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
