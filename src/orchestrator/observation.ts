/**
 * The drift digest's observation contract (WS-P3.0).
 *
 * TWO HALVES THAT MUST SHIP TOGETHER, or the producer wedges on its second post.
 *
 * The orchestrator dedups on `(source_system, source_reference, normalized_fact_hash)`, and
 * `observed_at` is INSIDE that fact hash. Re-recording the same source reference with different
 * facts is rejected as `observation_conflict`; there is no supersession. So:
 *
 *  * `source_reference` embeds the full upstream `generated_at` AND a digest of the facts. A new
 *    audit run has a new `generated_at`, so it appends a new row rather than conflicting; an
 *    identical re-post of the SAME report file is byte-identical and dedups on the idempotency key.
 *  * `observed_at` is the report's `generated_at` -- NEVER the post time. With a wall-clock post
 *    time, an unchanged re-post would produce the same reference but a different fact hash, which
 *    is precisely the conflict branch. Every run. Forever.
 *
 * `observed_at` is deliberately NOT duplicated inside `facts`: the reference already embeds
 * `generated_at`, so it varies whenever `observed_at` varies. Do not "fix" its absence.
 *
 * Facts are counts only. External text -- an unreachable instance's error, per-endpoint read
 * errors, proposal descriptions and reasoning -- never crosses this boundary, and rule keys are
 * never used as fact KEYS (the ingest secret scanner rejects any key containing "log", "body",
 * "credential", ...).
 */
import { createHash } from 'crypto';
import type { DriftReport } from '../standards/report.js';

export interface ObservationCommand {
  idempotency_key: string;
  expected_version: 0;
  source_system: 'drift_digest';
  source_reference: string;
  source_url: null;
  trust_classification: 'monitor';
  subject_type: 'service';
  subject_reference: string;
  environment: string;
  observation_type: 'drift';
  status: 'passed' | 'degraded' | 'unknown';
  severity: 'info' | 'warning' | 'critical';
  observed_at: string;
  summary: string;
  facts: Record<string, unknown>;
  payload_digest: null;
}

/**
 * Logical, stable subject identifiers. Deliberately NOT the instance base URLs: those come from
 * env at runtime and dev's is an OrbStack LAN address, so embedding one in a permanent record
 * would be both unstable and an internal-address leak.
 */
export const INSTANCE_SUBJECTS: Record<string, { subject: string; environment: string }> = {
  prod: { subject: 'coolify:prod', environment: 'production' },
  dev: { subject: 'coolify:dev', environment: 'development' },
};

/** Sorted-key, compact-separator JSON — the same recipe as the orchestrator's `fact_digest()`. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/**
 * Our own content address for the facts. This is NOT the orchestrator's `normalized_fact_hash`
 * and is never compared against it — it only has to be deterministic on this side.
 */
export function factDigest(facts: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson(facts), 'utf8').digest('hex').slice(0, 12);
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function buildInstanceFacts(
  report: DriftReport,
  instance: string,
): Record<string, unknown> {
  const section = report.instances[instance];
  const reportDate = report.generated_at.slice(0, 10);
  const readErrorCount = Array.isArray(section?.errors) ? section.errors.length : 0;

  if (!section || section.ok !== true) {
    return {
      report_date: reportDate,
      instance,
      instance_ok: false,
      read_error_count: readErrorCount,
    };
  }

  const summary = section.summary;
  const byRisk = (summary?.by_risk ?? {}) as Record<string, unknown>;
  const byKind = (summary?.by_kind ?? {}) as Record<string, unknown>;

  return {
    report_date: reportDate,
    instance,
    instance_ok: true,
    total_proposals: count(summary?.total_proposals),
    by_risk: {
      safe: count(byRisk.safe),
      caution: count(byRisk.caution),
      destructive: count(byRisk.destructive),
    },
    by_kind: {
      remediation: count(byKind.remediation),
      question: count(byKind.question),
    },
    delta_new: report.delta.new.filter((d) => d.instance === instance).length,
    delta_resolved: report.delta.resolved.filter((d) => d.instance === instance).length,
    read_error_count: readErrorCount,
  };
}

function statusFor(facts: Record<string, unknown>): ObservationCommand['status'] {
  if (facts.instance_ok !== true) return 'unknown';
  return count(facts.total_proposals) > 0 ? 'degraded' : 'passed';
}

function severityFor(facts: Record<string, unknown>): ObservationCommand['severity'] {
  if (facts.instance_ok !== true) return 'warning';
  const byRisk = (facts.by_risk ?? {}) as Record<string, unknown>;
  if (count(byRisk.destructive) > 0) return 'critical';
  return count(facts.total_proposals) > 0 ? 'warning' : 'info';
}

function summaryFor(subject: string, facts: Record<string, unknown>): string {
  if (facts.instance_ok !== true) return `${subject} — instance unreachable`;
  const total = count(facts.total_proposals);
  const noun = total === 1 ? 'standards proposal' : 'standards proposals';
  return `${subject} — ${total} ${noun} (${count(facts.delta_new)} new)`.slice(0, 512);
}

export function buildObservation(
  report: DriftReport,
  instance: string,
): ObservationCommand | null {
  const mapping = INSTANCE_SUBJECTS[instance];
  if (!mapping) return null;

  const facts = buildInstanceFacts(report, instance);
  const observedAt = report.generated_at;

  return {
    idempotency_key: `drift-digest:${observedAt}:${instance}`,
    expected_version: 0,
    source_system: 'drift_digest',
    source_reference: `infra-drift:${observedAt}:${instance}:${factDigest(facts)}`,
    source_url: null,
    trust_classification: 'monitor',
    subject_type: 'service',
    subject_reference: mapping.subject,
    environment: mapping.environment,
    observation_type: 'drift',
    status: statusFor(facts),
    severity: severityFor(facts),
    observed_at: observedAt,
    summary: summaryFor(mapping.subject, facts),
    facts,
    payload_digest: null,
  };
}

/** One command per audited instance. Instances with no subject mapping are skipped, not thrown on. */
export function buildObservations(report: DriftReport): ObservationCommand[] {
  return Object.keys(report.instances)
    .map((instance) => buildObservation(report, instance))
    .filter((o): o is ObservationCommand => o !== null);
}
