// Orchestrates a security-drift run: parse → classify → auto-fix the narrow set →
// emit the rest to the change-manager → email only NEW urgent items. Deps (CM POST,
// urgent email) are injected so this is unit-testable; file paths point at the
// 0600-validated baseline / emit-state / rollback stores.

import type { SyncBody, SyncSummary } from "../change-manager/api-client.js";
import { diffFindings, loadBaseline, saveBaseline, snapshot } from "./baseline.js";
import { buildEscalations, mergeEmitState, newEscalations, type ClassifiedFinding, type SecurityEscalation } from "./emit.js";
import { loadEmitState, pruneEmitState, saveEmitState } from "./emit-state.js";
import { runAutoFixes } from "./autofix.js";
import { parseScan } from "./scan-parser.js";
import { classify } from "./taxonomy.js";

export interface RunnerConfig {
  scanStdout: string;
  now: string; // ISO
  autoFixAllowlist: string[];
  fpExtra?: string[];
  baselineFile: string;
  emitStateFile: string;
  rollbackLog: string;
  autoFixCap: number;
  emitStateMaxAgeDays?: number;
}

export interface RunnerDeps {
  postSync: (body: SyncBody) => Promise<SyncSummary>;
  sendUrgent: (items: SecurityEscalation[]) => Promise<boolean>;
}

export interface RunnerResult {
  seeded: boolean;
  autoFixed: { target: string; priorMode: number }[];
  autoFixBlocked: { target: string; reason: string }[];
  emitted: number;
  urgent: number;
  urgentEmailed: number;
  digest: string;
}

export async function runSecurityDrift(config: RunnerConfig, deps: RunnerDeps): Promise<RunnerResult> {
  const date = config.now.slice(0, 10);
  const findings = parseScan(config.scanStdout).filter((f) => f.severity !== "PASS");

  const classifiedAll: ClassifiedFinding[] = [];
  for (const finding of findings) {
    const classification = classify(finding, { autoFixAllowlist: config.autoFixAllowlist, fpExtra: config.fpExtra });
    if (classification) classifiedAll.push({ finding, classification });
  }

  // --- AUTO-FIX the narrow set; blocked ones re-tier to URGENT ---
  const autoCandidates = classifiedAll.filter((c) => c.classification.tier === "AUTO_FIX");
  const byTarget = new Map(autoCandidates.map((c) => [c.finding.target, c]));
  const run = runAutoFixes(
    autoCandidates.map((c) => c.finding.target),
    { allowlist: config.autoFixAllowlist, rollbackLog: config.rollbackLog, cap: config.autoFixCap },
  );

  // Items that go to the CM for approval = non-auto findings + blocked-autofix (re-tiered URGENT).
  const nonAuto: ClassifiedFinding[] = classifiedAll.filter((c) => c.classification.tier !== "AUTO_FIX");
  for (const b of run.blocked) {
    const orig = byTarget.get(b.target);
    if (!orig) continue;
    nonAuto.push({
      finding: orig.finding,
      classification: {
        tier: "URGENT",
        kind: "question",
        risk: "caution",
        remediation: { manual: [`Auto-fix BLOCKED (${b.reason}). Review and tighten ${b.target} manually.`] },
        title: orig.classification.title,
      },
    });
  }

  // Diff is for the immediate-email gate only. Use the FINAL classification of every
  // current finding (auto-fixed keep AUTO_FIX; blocked counted as URGENT).
  const finalClassified: ClassifiedFinding[] = [
    ...autoCandidates.filter((c) => run.applied.some((a) => a.target === c.finding.target)),
    ...nonAuto,
  ];
  const baseline = loadBaseline(config.baselineFile);
  const seeded = baseline === null;
  const diffs = seeded ? [] : diffFindings(finalClassified, baseline);

  // --- Emit the full current non-auto set every run (so reconcile resolves cleared items correctly) ---
  const { escalations, hashes } = buildEscalations(nonAuto, config.now);
  await deps.postSync({
    generated_at: config.now,
    source_report: `${date}.security.json`,
    source: "security",
    escalations,
  });

  // Persist plan-hashes (merge + prune) for the 4am integrity gate.
  const merged = mergeEmitState(pruneEmitState(loadEmitState(config.emitStateFile), config.emitStateMaxAgeDays ?? 14, config.now), hashes, config.now);
  saveEmitState(config.emitStateFile, merged);

  // --- Immediate URGENT email: only NEW urgent items, and never on the seed run ---
  const newUrgent = seeded ? [] : newEscalations(escalations.filter((e) => e.urgent), diffs);
  let urgentEmailed = 0;
  if (newUrgent.length) urgentEmailed = (await deps.sendUrgent(newUrgent)) ? newUrgent.length : 0;

  // Update the accepted baseline.
  saveBaseline(config.baselineFile, snapshot(finalClassified, config.now, baseline ?? {}));

  const urgent = escalations.filter((e) => e.urgent).length;
  const digest = renderDigest(date, { seeded, run, escalations, urgent });
  return { seeded, autoFixed: run.applied, autoFixBlocked: run.blocked, emitted: escalations.length, urgent, urgentEmailed, digest };
}

function renderDigest(
  date: string,
  s: { seeded: boolean; run: { applied: { target: string; priorMode: number }[]; blocked: { target: string; reason: string }[] }; escalations: SecurityEscalation[]; urgent: number },
): string {
  const lines: string[] = [];
  lines.push(`# Security drift ${date}`);
  if (s.seeded) lines.push("", "_First run: accepted baseline seeded; no urgent emails sent. Items below are queued for approval._");
  lines.push("", `**${s.escalations.length} need approval** (${s.urgent} urgent) · ${s.run.applied.length} auto-fixed · ${s.run.blocked.length} blocked→urgent`);
  if (s.run.applied.length) {
    lines.push("", "## Auto-fixed (chmod 600)");
    for (const a of s.run.applied) lines.push(`- ${a.target} (was ${a.priorMode.toString(8)})`);
  }
  if (s.escalations.length) {
    lines.push("", "## Needs approval");
    for (const e of s.escalations) lines.push(`- ${e.urgent ? "🚨 " : ""}[${e.plan.tier}] ${e.target.name} — ${e.reasoning}`);
  }
  lines.push("", "## Blind spots", s.escalations[0]?.plan.blind_spots ?? "File-scan excludes env vars and git history; rotation still required.");
  return lines.join("\n");
}
