---
name: infraops-mcp-server
tier: active
status: active
purpose: Multi-provider MCP server executing infra ops across Coolify, Hetzner, VPS,
  Namecheap, Cloudflare, and GitHub.
version: 3.4.0
version_source: package.json
updated: '2026-08-01'
delivery_profile: dependency-update
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

- [x] (P1) Rotation executor verifies the staged credential before any keeper, quarantine, or consumer write. PR #36 / commit 99e593a reordered the path to read-staged→verify-new→store→deploy→revoke-confirm and added a regression test proving a bad token leaves every consumer untouched. — added 2026-07-02; verified resolved 2026-07-04
- [ ] (P2) The drift-observation CLI's (`src/cli/orchestrator-cli.ts`) fail-open per-instance posting loop, `--dry-run` no-post path, and non-zero exit code now have direct `doObserve` vitest coverage (added in the WS-P3.0 final-review fix wave: client-construction failure, mixed success/failure posting, and skipped-instance visibility are all exercised). Still uncovered: `scripts/drift-audit.sh`'s own consumption of the CLI's exit code and `WARN` line (the shell side of the fail-open contract), and anything exercising the compiled `dist/` output rather than `src/` directly. Originally misfiled in `orchestrator/PROJECT.md` (wrong repo per the per-repo-PROJECT.md convention); moved here and reworded to reflect what remains. — added 2026-07-28
- [ ] (P2) `make check` runs ZERO tests in this repo, by construction: every test step in the vendored polyglot Makefile is gated behind `[ -f pyproject.toml ]`, and this is a TypeScript repo with no `pyproject.toml` — so the only test line (`pytest`) never fires, and `make check` exits 0 having lint/type/format/shellcheck'd but tested nothing. The suite is not actually unguarded (CI runs `npm test` directly, `.github/workflows/build.yml:37`), so this is a LOCAL gate gap: a developer or agent who runs `make check` before declaring work done gets a green that proves no test ran. Same class as the portfolio-wide "`uv sync` installs no extras" and orchestrator's "`make check` exit 0 does not prove the tests ran" invariants. Fix: add a `[ -f package.json ]`-gated `npm test` step to the `check` target. Surfaced by the WS-P3.0 final-review re-review. — added 2026-07-28
- [ ] (P2) make check runs NO TESTS in this repo: the vendored Makefile's only test block is gated on 'pyproject.toml' (pytest), which this repo does not have, so the 524-test vitest suite is never invoked by the gate. eslint, tsc --noEmit, prettier and shellcheck all run correctly; only tests are missed. A contributor running 'make check' gets exit 0 having executed zero tests, which is the portfolio-wide 'exit 0 does not prove tests ran' invariant appearing in its TypeScript form. Fix: add a package.json-gated block running 'npm test' (or vitest run) alongside the pyproject-gated pytest block. Surfaced by the WS-P2.8 Task 10 controller gate run 2026-07-28. — added 2026-07-28
## Future plans
