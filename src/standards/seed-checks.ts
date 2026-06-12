import type { StandardCheck } from "./check-engine.js";

// Offline fallback copy of the three seeded Coolify checks.
// These mirror what infra-brain seeds in its Phase 0 setup.
export const SEED_CHECKS: StandardCheck[] = [
  {
    rule_id: 1,
    rule_text: "Health checks must be enabled on running applications",
    severity: "WARN",
    schema_version: 1,
    resource: "coolify_application",
    assert: { field: "health_check_enabled", op: "eq", value: true },
    when: { field: "status", op: "contains", value: "running" },
    remediation_key: "coolify.enable_healthcheck",
    kind: "remediation",
  },
  {
    rule_id: 2,
    rule_text: "Applications must use HTTPS (not HTTP) in their domain",
    severity: "WARN",
    schema_version: 1,
    resource: "coolify_application",
    assert: { field: "fqdn", op: "not_starts_with", value: "http://" },
    when: { field: "fqdn", op: "non_empty" },
    remediation_key: "coolify.force_https",
    kind: "remediation",
  },
  {
    rule_id: 3,
    rule_text: "Production databases require scheduled backups",
    severity: "WARN",
    schema_version: 1,
    resource: "coolify_database",
    assert: { field: "backup_configs", op: "non_empty" },
    when: { field: "status", op: "contains", value: "running" },
    kind: "question",
  },
];
