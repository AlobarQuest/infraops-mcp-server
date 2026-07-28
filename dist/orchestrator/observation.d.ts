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
export declare const INSTANCE_SUBJECTS: Record<string, {
    subject: string;
    environment: string;
}>;
/** Sorted-key, compact-separator JSON — the same recipe as the orchestrator's `fact_digest()`. */
export declare function canonicalJson(value: unknown): string;
/**
 * Our own content address for the facts. This is NOT the orchestrator's `normalized_fact_hash`
 * and is never compared against it — it only has to be deterministic on this side.
 */
export declare function factDigest(facts: Record<string, unknown>): string;
export declare function buildInstanceFacts(report: DriftReport, instance: string): Record<string, unknown>;
export declare function buildObservation(report: DriftReport, instance: string): ObservationCommand | null;
/** One command per audited instance. Instances with no subject mapping are skipped, not thrown on. */
export declare function buildObservations(report: DriftReport): ObservationCommand[];
//# sourceMappingURL=observation.d.ts.map