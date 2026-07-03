---
name: infraops-mcp-server
tier: active
status: active
purpose: Multi-provider MCP server executing infra ops across Coolify, Hetzner, VPS,
  Namecheap, Cloudflare, and GitHub.
version: 3.4.0
version_source: package.json
updated: '2026-06-26'
foundation: true
foundation_contract: 1
applicable_standards:
  project: '1.0'
  security: '1.0'
  code: '1.0'
required_checks:
- id: quality
  executor: github-actions:quality.yml
---

## Backlog

- [ ] (P3) Deep-link the 4 AM change-window execution report email to the dashboard, same as the 3 AM digest got in PR #23. It's a report of completed work rather than an approve prompt, so lower priority. — added 2026-06-26
- [ ] (P2) Close executor capability gaps surfaced by the manual lane: the secret-rotation class (e.g. veritok-ingest-shared-secret — generate a secret, write to BWS, update a Coolify env var in-place, update the iOS Shortcut bearer token) and local-Mac remediations (chmod a local file) the VPS executor can't do. Decision 2026-06-26: handle via a MANUAL lane (human fixes it; next 3 AM scan auto-resolves), do NOT build a local executor yet — revisit if local-file items recur often. — added 2026-06-26
- [ ] (P2) probe-guard blind spot: internal-only apps (unreachable fqdn, e.g. Watchtower at watchtower.local on dev Coolify) fail the external HTTP probe, so the guard HOLDS them even when they're fully conformant (Watchtower serves /api/health on port 3000, health_check_path/port already set, just health_check_enabled=false). Coolify's health check runs container-internal (127.0.0.1:port), which would pass. Fix: for an unreachable/internal fqdn, probe container-internally (vps_exec on the host) or recognize internal apps, instead of blocking. Surfaced via change-manager item 15. — added 2026-06-27
- [x] (P2) Onboard to code-standards (foundation matrix red: code.not-onboarded) — added 2026-07-02

- [ ] (P1) Rotation executor should VERIFY the new credential authenticates BEFORE deploying it to consumers (currently store→deploy→verify; a bad staged credential reached a live consumer and broke it during the 2026-07-03 Bitbucket rotation before verify caught it). Reorder to read-staged→verify-new→store→deploy→revoke-confirm so a bad value never touches a live consumer. Workaround in use: pre-validate the staged token read-only before running the executor. — added 2026-07-02
## Future plans
