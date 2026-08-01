# Kickoff prompt — Change Manager Plan 3 (mini-side executor)

> Paste the block below into a **fresh** Claude Code session started in `~/Projects/infraops-mcp-server`.
> **Prerequisite status (both DONE):** Plan 1 contract v2 is merged; Plan 2c Part 2 is
> done — the `change-manager` app is live at `https://change-mgr.alobar.net` with its M2M
> token in BWS. Tasks 1–6 are offline code (mocked API/coolify-client/Anthropic); the live
> wiring + first run are operational follow-ups to do **with Devon** in a separate session.
> The live facts below were filled in from the Part-2 deploy session (2026-06-14).

---

Build the mini-side of the change manager — the sync step + the 04:00 window
executor — by executing:

docs/superpowers/plans/2026-06-14-change-manager-3-executor.md

Start in ~/Projects/infraops-mcp-server. This is TypeScript in the infraops-mcp-server
repo (vitest, the existing coolify-client, @anthropic-ai/sdk). Execute it
subagent-driven (fresh subagent per task, two-stage review), the same way Plans
1/2a/2b were built. Branch off main; each task is TDD; rebuild + commit the tracked
dist/ at the end; merge to main and push. Read the design spec first:
docs/superpowers/specs/2026-06-14-change-manager-design.md (Sub-project B).

── PREREQUISITES (both already DONE — verify, don't redo) ──

- Plan 1 contract v2 is merged: src/standards/remediation-report.ts has `instance`
  and `schema_version: 2`. The executor consumes this v2 escalations contract.
- Plan 2c Part 2 is done: the change-manager web app is LIVE and verified at
  https://change-mgr.alobar.net (Flavor B, Postgres, Alobar ID forward-auth on the
  GUI, M2M bearer on /api/_). The mini only ever talks to /api/_ with the M2M token.

── LIVE WIRING FACTS (produced by Part 2 — use these to fill the plan's placeholders) ──

- API base URL: https://change-mgr.alobar.net
- /api/* is M2M-only: no forward-auth on /api — the mini just sends
  `Authorization: Bearer <M2M_TOKEN>`. (GUI paths are SSO'd;
  /api is not. A request to /api without the token → 401.)
- M2M token (fills BWS_CHANGE_MGR_M2M_SECRET_ID):
  BWS secret change-manager/M2M_TOKEN
  secret UUID af0e4192-edc6-46ae-9e4f-b469011dbb8d
  BWS project Ops/Platform 26ff7e3e-8769-45ff-885c-b415013b4bbf
- API endpoints the executor uses (all M2M):
  GET /api/items?status=approved → the window's work
  POST /api/items/{id}/claim → atomic approved→in_progress; 409 if not approved (skip)
  POST /api/items/{id}/outcome → {outcome, detail, tool_calls, rollback}
  POST /api/window-runs / PATCH /api/window-runs/{id}
  POST /api/sync → the daily sync (see payload below)
  GET /api/health
- /api/sync payload (matches the app's SyncRequest/EscalationIn):
  { generated_at: str, source_report: str, escalations: [
  { proposal_id, instance, target:{provider,resource_type,uuid,name},
  risk, kind, reasoning, plan:{...}, note? } ] }
  proposal_id format is single-colon `<ruleKey>:<nanoid8>` (e.g. coolify.enable_https:Ab3xK9z1).
  The app derives identity = `{instance}::{ruleKey}::{uuid}` exactly like
  src/standards/report.ts proposalIdentity(). Do NOT pass a `::`-delimited identity
  as proposal_id. The existing escalation contract already emits the right shape;
  the sync client should send escalations straight from the day's <date>.remediation.json.

── change-window.sh (Task 7): mirror scripts/drift-audit.sh ──
drift-audit.sh already fetches secrets by UUID via get_secret_by_id with these
defaults (reuse them verbatim):
COOLIFY prod API token bbd71f41-b7df-4ae9-8fdb-b41501447308
ANTHROPIC_API_KEY b74bf8b3-938b-45c0-bc25-b415013cb563
change-window.sh additionally needs the change-mgr M2M token
(af0e4192-edc6-46ae-9e4f-b469011dbb8d) and a NEW Healthchecks.io check UUID
(create with Devon). Chain `change-mgr sync` onto the END of the existing 03:00
drift-audit.sh run (audit → remediate → sync), best-effort: a sync failure logs a
warning but must NOT fail the audit/remediate heartbeat.

── CRITICAL CORRECTNESS (the parts that matter most) ──

- Task 2 tools.ts is the ENTIRE blast-radius boundary. ONLY: get_application (read),
  set_application_domains (http→https) + redeploy_application, set_application_healthcheck,
  report_done, report_blocked. An unknown/hallucinated tool name MUST throw — never
  execute by name. Sonnet is known to invent tools (coolify_redeploy_application,
  coolify_create_s3_storage) — those must be impossible to fire.
- Each curated write: capture rollback BEFORE, re-validate live (already-conformant →
  skipped_conformant→resolved), post-verify AFTER (still drifted/unhealthy → revert via
  captured rollback + mark failed).
- Task 3 agent.ts (Sonnet tool-use loop) must NEVER throw — any model/tool/API error on
  an item → outcome `failed`, continue. Stop conditions: report_done/blocked, maxSteps cap.
  Model: claude-sonnet-4-6. If the @anthropic-ai/sdk tool-use shape differs from the
  plan's code, adapt the SDK mechanics but keep the behavior.
- Task 4 run-window.ts: claim 409 → skip without aborting the batch; MAX_CHANGES_PER_WINDOW
  (default 5) cap; per-item isolation (one failure never aborts the batch); change-mgr API
  unreachable → abort cleanly (nothing applied) + ping Healthchecks /fail.

── REALISTIC SCOPE (don't over-build) ──

- HTTPS (rule #571) is the one genuinely auto-executable type: set domains http→https →
  redeploy → post-verify cert, with rollback. This is the real value.
- Health-check items are frequently `blocked` (need a human path decision) — that's a
  first-class outcome, not a failure.
- DB backups (rule #572) are OUT OF SCOPE for the executor — fix lives in vps-backup
  (BACKLOG #3) and re-pointing #572 (BACKLOG #4); resolved by human defer/wontfix in the GUI.

── GOTCHAS from the Part-2 session (save time) ──

- BWS access: if `bws` returns `invalid_client`, the inherited BWS_ACCESS_TOKEN is the
  stale/revoked one. A working machine token is in macOS Keychain under service
  `bws-cm-token` — prepend `export BWS_ACCESS_TOKEN="$(security find-generic-password
-s bws-cm-token -w)"` to bws calls (or ask Devon to refresh it).
- coolify-client correctness: a real endpoint bug was found+fixed this session
  (create-database used /databases instead of /databases/{type}). Before trusting the
  redeploy/domains curated tools, sanity-check the EXACT coolify-client endpoints they
  wrap against the live API (redeploy is POST /applications/{uuid}/restart or /deploy;
  domains is PATCH /applications/{uuid} with force_domain_override for self-referential
  http→https). Verify against Coolify 4.0.0-beta.473.

── OPERATIONAL (do WITH Devon, NOT autonomously) ──
Tasks 1–6 are pure code (mocked API/coolify-client/Anthropic) — build + verify offline.
The launchd install (install-change-window-launchd.sh, mirroring the drift one) and the
first live run are operational follow-ups with Devon after the code merges: approve one
HTTPS item in the GUI, `launchctl start com.devon.change-window`, confirm the change
lands and the item shows `done` with its tool-call audit. That closes the full loop:
audit → remediate(auto-fix safe) → escalate → review/approve → window-execute.

Keep this a CODE-BUILD session; the live wiring/first run is a separate operational
session (don't mix build with prod mutation). Approval gates stay on.
