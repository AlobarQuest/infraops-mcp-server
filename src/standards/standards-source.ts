import fs from "fs";
import path from "path";
import os from "os";
import { infrabrainGet, isInfrabrainConfigured } from "../services/infrabrain-client.js";
import { SEED_CHECKS } from "./seed-checks.js";
import type { StandardCheck } from "./check-engine.js";

const CACHE_PATH = path.join(os.homedir(), ".infraops", "standards-cache.json");

interface RawRule {
  id: number;
  rule: string;
  reason?: string;
  severity: string;
  category?: string;
  check?: Record<string, unknown> | null;
}

function toStandardCheck(r: RawRule): StandardCheck {
  const c = r.check as unknown as StandardCheck;
  return {
    ...c,
    rule_id: c.rule_id ?? r.id,
    rule_text: c.rule_text ?? r.rule,
    severity: (c.severity ?? r.severity) as StandardCheck["severity"],
    schema_version: c.schema_version ?? 1,
  };
}

function writeCache(checks: StandardCheck[]): void {
  try {
    const dir = path.dirname(CACHE_PATH);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(checks, null, 2), "utf-8");
  } catch {
    // best-effort
  }
}

function readCache(): StandardCheck[] | null {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    const raw = fs.readFileSync(CACHE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as StandardCheck[];
  } catch {
    return null;
  }
}

export async function loadCoolifyChecks(): Promise<{
  checks: StandardCheck[];
  source: "live" | "cache" | "seed";
}> {
  if (isInfrabrainConfigured()) {
    try {
      const { rules } = await infrabrainGet<{ rules: RawRule[] }>("/api/rules", { category: "coolify" });
      const checks = rules.filter((r) => r.check).map(toStandardCheck);
      writeCache(checks);
      return { checks, source: "live" };
    } catch {
      // fall through to cache/seed
    }
  }

  const cached = readCache();
  if (cached) return { checks: cached, source: "cache" };

  return { checks: SEED_CHECKS, source: "seed" };
}
