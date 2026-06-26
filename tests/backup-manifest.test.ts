import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBackupManifest, enrichWithBackupCoverage } from "../src/standards/backup-manifest.js";

// loadBackupManifest reads a PROD manifest (MANIFEST_PATH / BACKUP_MANIFEST_FILE) and a DEV
// manifest (BACKUP_MANIFEST_FILE_ORB) and merges them, so a dev DB backed up by backup-orb.sh
// reads as covered just like a prod DB backed up by backup.sh.
describe("loadBackupManifest (prod + dev merge)", () => {
  let dir: string;
  const saved = {
    MANIFEST_PATH: process.env.MANIFEST_PATH,
    BACKUP_MANIFEST_FILE: process.env.BACKUP_MANIFEST_FILE,
    BACKUP_MANIFEST_FILE_ORB: process.env.BACKUP_MANIFEST_FILE_ORB,
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bm-test-"));
    delete process.env.MANIFEST_PATH;
    delete process.env.BACKUP_MANIFEST_FILE;
    delete process.env.BACKUP_MANIFEST_FILE_ORB;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const writeManifest = (name: string, obj: unknown): string => {
    const p = join(dir, name);
    writeFileSync(p, JSON.stringify(obj));
    return p;
  };

  it("merges prod and dev manifests (a dev DB reads as covered)", async () => {
    process.env.MANIFEST_PATH = writeManifest("prod.json", {
      "prod-uuid": { label: "appbrain", last_success: "2026-06-26T03:00:00Z" },
    });
    process.env.BACKUP_MANIFEST_FILE_ORB = writeManifest("dev.json", {
      "s2prstn489509v7po7icp7z9": { label: "facelesstt", last_success: "2026-06-26T04:00:00Z" },
    });
    const m = await loadBackupManifest();
    expect(Object.keys(m).sort()).toEqual(["prod-uuid", "s2prstn489509v7po7icp7z9"]);
    expect(m["s2prstn489509v7po7icp7z9"].label).toBe("facelesstt");
  });

  it("works with only the prod manifest present (dev missing → just prod)", async () => {
    process.env.MANIFEST_PATH = writeManifest("prod.json", {
      "prod-uuid": { label: "appbrain", last_success: "2026-06-26T03:00:00Z" },
    });
    process.env.BACKUP_MANIFEST_FILE_ORB = join(dir, "does-not-exist.json");
    const m = await loadBackupManifest();
    expect(Object.keys(m)).toEqual(["prod-uuid"]);
  });

  it("returns empty when neither manifest exists (fail-closed for the assertion)", async () => {
    process.env.MANIFEST_PATH = join(dir, "nope-prod.json");
    process.env.BACKUP_MANIFEST_FILE_ORB = join(dir, "nope-dev.json");
    expect(await loadBackupManifest()).toEqual({});
  });

  it("ignores a malformed manifest file rather than throwing", async () => {
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{ not json");
    process.env.MANIFEST_PATH = bad;
    process.env.BACKUP_MANIFEST_FILE_ORB = writeManifest("dev.json", {
      "dev-uuid": { label: "facelesstt", last_success: "2026-06-26T04:00:00Z" },
    });
    const m = await loadBackupManifest();
    expect(Object.keys(m)).toEqual(["dev-uuid"]);
  });
});

describe("enrichWithBackupCoverage", () => {
  const now = Date.parse("2026-06-26T12:00:00Z");
  it("marks a manifest-present DB covered, and fresh when within 24h", () => {
    const db: Record<string, unknown> = { uuid: "u1" };
    enrichWithBackupCoverage(db, { u1: { label: "x", last_success: "2026-06-26T06:00:00Z" } }, now);
    expect(db.backup_covered).toBe(true);
    expect(db.backup_fresh).toBe(true);
  });
  it("marks covered but NOT fresh when the last backup is older than 24h", () => {
    const db: Record<string, unknown> = { uuid: "u1" };
    enrichWithBackupCoverage(db, { u1: { label: "x", last_success: "2026-06-24T06:00:00Z" } }, now);
    expect(db.backup_covered).toBe(true);
    expect(db.backup_fresh).toBe(false);
  });
  it("marks an absent DB uncovered", () => {
    const db: Record<string, unknown> = { uuid: "missing" };
    enrichWithBackupCoverage(db, { u1: { label: "x", last_success: "2026-06-26T06:00:00Z" } }, now);
    expect(db.backup_covered).toBe(false);
    expect(db.backup_fresh).toBe(false);
  });
});
