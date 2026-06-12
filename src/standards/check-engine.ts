import { randomBytes } from "crypto";

export type Op =
  | "eq" | "neq" | "contains" | "not_contains"
  | "present" | "absent" | "empty" | "non_empty"
  | "starts_with" | "not_starts_with" | "matches";

export interface Assertion { field: string; op: Op; value?: unknown; }

export interface StandardCheck {
  rule_id: number;
  rule_text: string;
  severity: "BLOCK" | "WARN" | "INFO";
  schema_version: number;
  resource: "coolify_application" | "coolify_database";
  assert: Assertion;
  when?: Assertion;
  remediation_key?: string;
  kind: "remediation" | "question";
}

export type Risk = "safe" | "caution" | "destructive";
export type Confidence = "high" | "medium" | "low";

export interface PlannedAction { tool: string; args: Record<string, unknown>; }

export interface Proposal {
  id: string;
  kind: "remediation" | "question";
  source: "standards-audit";
  status: "pending";
  target: { provider: "coolify"; resource_type: string; uuid: string; name: string };
  description: string;
  reasoning: string;
  confidence: Confidence;
  risk: Risk;
  planned_action: PlannedAction | null;
  question: string | null;
}

function fieldValue(resource: Record<string, unknown>, field: string): unknown {
  return resource[field];
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function isEmpty(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "string") return value.length === 0;
  return !isPresent(value);
}

// Returns true when the assertion passes (resource CONFORMS), false when it VIOLATES.
function evalAssertion(assertion: Assertion, resource: Record<string, unknown>): boolean | null {
  const { field, op, value } = assertion;
  const v = fieldValue(resource, field);

  switch (op) {
    case "eq": return v === value;
    case "neq": return v !== value;
    case "contains": return typeof v === "string" ? v.includes(String(value)) : false;
    case "not_contains": return typeof v === "string" ? !v.includes(String(value)) : true;
    case "present": return isPresent(v);
    case "absent": return !isPresent(v);
    case "empty": return isEmpty(v);
    case "non_empty": return !isEmpty(v);
    case "starts_with": return typeof v === "string" ? v.startsWith(String(value)) : false;
    case "not_starts_with": return typeof v === "string" ? !v.startsWith(String(value)) : true;
    case "matches": {
      if (typeof v !== "string") return false;
      try { return new RegExp(String(value)).test(v); } catch { return false; }
    }
    default:
      return null; // unknown op → skip
  }
}

function nanoid8(): string {
  return randomBytes(4).toString("hex");
}

export function evaluateCheck(
  check: StandardCheck,
  resource: Record<string, unknown>,
  resolveRemediation: (key: string, res: Record<string, unknown>) =>
    { action: PlannedAction; risk: Risk } | null,
): Proposal | null {
  // Evaluate precondition (when)
  if (check.when) {
    const precond = evalAssertion(check.when, resource);
    if (precond === null || precond === false) return null;
  }

  // Evaluate main assertion
  const conforms = evalAssertion(check.assert, resource);
  if (conforms === null) return null; // unknown op → skip
  if (conforms === true) return null; // resource conforms → no proposal

  // Resource violates → build proposal
  const uuid = String(resource.uuid ?? "");
  const name = String(resource.name ?? "");
  const resourceType = check.resource.replace("coolify_", "");
  const id = `${check.remediation_key ?? check.rule_id}:${nanoid8()}`;

  let kind: "remediation" | "question" = check.kind;
  let plannedAction: PlannedAction | null = null;
  let risk: Risk = "safe";

  if (check.remediation_key) {
    const resolved = resolveRemediation(check.remediation_key, resource);
    if (resolved) {
      kind = "remediation";
      plannedAction = resolved.action;
      risk = resolved.risk;
    } else {
      kind = "question";
      plannedAction = null;
      risk = "safe";
    }
  }

  const description = `${resourceType.charAt(0).toUpperCase() + resourceType.slice(1)} '${name}' violates standard: ${check.rule_text}`;
  const reasoning = `infra-brain rule #${check.rule_id} (${check.severity}): ${check.rule_text}`;
  const question = kind === "question"
    ? `${description}. Review and fix manually?`
    : null;

  return {
    id,
    kind,
    source: "standards-audit",
    status: "pending",
    target: { provider: "coolify", resource_type: resourceType, uuid, name },
    description,
    reasoning,
    confidence: "high",
    risk,
    planned_action: plannedAction,
    question,
  };
}
