// The 4am verbatim security executor. Runs APPROVED security items as EXACT commands
// (no LLM), gated by a plan-hash integrity check anchored in the Mac-side emit-state.
//
// This is the lethal-trifecta control: drift data → human approval → a pre-vetted
// deterministic command. There is no model in this write path. A plan whose hash does
// not match the one recorded when it was emitted is REFUSED (possible tamper between
// approval and execution) and raised as an alert.

import { execFileSync } from "node:child_process";
import type { ApprovedItem, OutcomeBody } from "../change-manager/api-client.js";
import { planHash } from "./canonical.js";
import { loadEmitState, type EmitState } from "./emit-state.js";

export interface ExecResult {
  ok: boolean;
  detail: string;
}

export interface SecurityWindowDeps {
  getApprovedSecurity: () => Promise<ApprovedItem[]>;
  claim: (id: number) => Promise<void>;
  postOutcome: (id: number, body: OutcomeBody) => Promise<void>;
  /** fired on a plan-hash mismatch / missing hash (possible tamper) */
  onIntegrityFailure: (item: ApprovedItem, reason: string) => Promise<void>;
  emitStateFile: string;
  maxChanges: number;
  /** injectable for tests; defaults to execFileSync (shell:false) */
  exec?: (cmd: string[]) => ExecResult;
  timeoutMs?: number;
}

export interface SecurityWindowSummary {
  considered: number;
  applied: number;
  failed: number;
  blocked: number;
  skipped: number;
  results: Array<{ name: string; outcome: string; detail: string }>;
}

function defaultExec(timeoutMs: number) {
  return (cmd: string[]): ExecResult => {
    try {
      const out = execFileSync(cmd[0], cmd.slice(1), { shell: false, timeout: timeoutMs, encoding: "utf8" });
      return { ok: true, detail: String(out).slice(0, 500) };
    } catch (e: any) {
      return { ok: false, detail: `exit ${e?.status ?? "?"}: ${(e?.stderr || e?.message || "").toString().slice(0, 500)}` };
    }
  };
}

interface Remediation {
  exec?: string[][];
  manual?: string[];
}

export async function runSecurityWindow(deps: SecurityWindowDeps): Promise<SecurityWindowSummary> {
  const summary: SecurityWindowSummary = { considered: 0, applied: 0, failed: 0, blocked: 0, skipped: 0, results: [] };
  const items = (await deps.getApprovedSecurity()).slice(0, deps.maxChanges);
  if (!items.length) return summary;

  // The emit-state read itself validates the trust boundary (0600/owner). If it is
  // tampered, refuse the whole batch rather than trusting any recorded hash.
  let emitState: EmitState;
  try {
    emitState = loadEmitState(deps.emitStateFile);
  } catch (e) {
    for (const item of items) {
      summary.considered++;
      summary.blocked++;
      const reason = `emit-state integrity failure: ${e instanceof Error ? e.message : String(e)}`;
      summary.results.push({ name: item.resource_name, outcome: "blocked", detail: reason });
      await deps.onIntegrityFailure(item, reason).catch(() => {});
    }
    return summary;
  }

  const exec = deps.exec ?? defaultExec(deps.timeoutMs ?? 60_000);

  for (const item of items) {
    summary.considered++;
    try {
      await deps.claim(item.id); // 409 if no longer approved → skip
    } catch {
      summary.skipped++;
      summary.results.push({ name: item.resource_name, outcome: "skipped", detail: "claim failed (already claimed?)" });
      continue;
    }

    // --- INTEGRITY GATE ---
    const recorded = emitState[item.resource_uuid];
    const computed = planHash(item.plan);
    if (!recorded || recorded.hash !== computed) {
      const reason = recorded
        ? "plan integrity check FAILED — plan hash does not match the value recorded at emit time (possible tamper)"
        : "no recorded plan hash for this item — refusing to execute an unverified plan";
      summary.blocked++;
      summary.results.push({ name: item.resource_name, outcome: "blocked", detail: reason });
      await deps.postOutcome(item.id, { outcome: "blocked", detail: reason }).catch(() => {});
      await deps.onIntegrityFailure(item, reason).catch(() => {});
      continue;
    }

    const remediation = (item.plan?.remediation ?? {}) as Remediation;

    // manual remediations are tracked, never executed.
    if (Array.isArray(remediation.manual) || !Array.isArray(remediation.exec)) {
      summary.blocked++;
      const detail = "manual remediation — needs human action (not auto-executed)";
      summary.results.push({ name: item.resource_name, outcome: "blocked", detail });
      await deps.postOutcome(item.id, { outcome: "blocked", detail }).catch(() => {});
      continue;
    }

    // --- VERBATIM EXECUTION (no shell, array args) ---
    const details: string[] = [];
    let failed = false;
    for (const cmd of remediation.exec) {
      if (!Array.isArray(cmd) || cmd.length === 0 || cmd.some((a) => typeof a !== "string")) {
        failed = true;
        details.push(`malformed command: ${JSON.stringify(cmd)}`);
        break;
      }
      const r = exec(cmd);
      details.push(`${cmd.join(" ")} → ${r.ok ? "ok" : r.detail}`);
      if (!r.ok) { failed = true; break; }
    }

    const outcome: OutcomeBody["outcome"] = failed ? "failed" : "done";
    if (failed) summary.failed++; else summary.applied++;
    const detail = details.join(" | ");
    summary.results.push({ name: item.resource_name, outcome, detail });
    await deps.postOutcome(item.id, { outcome, detail }).catch(() => {});
  }

  return summary;
}
