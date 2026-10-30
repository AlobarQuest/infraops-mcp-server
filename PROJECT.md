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
  code: '1.1'
required_checks:
- id: quality
  executor: github-actions:quality.yml
---

## Backlog

- [ ] (P2) Production Coolify's API answers plain HTTP on its public address (`http://178.156.247.239:8000`) and on `http://coolify-1.devonwatkins.com` (HTTPS gets no answer), so every API token sent that way, infraops' production token included, crosses the internet unencrypted. Measured 2026-10-14: both answer 401 to an unauthenticated `/api/v1/version`; the tailnet address `100.112.188.96:8000` answers the same and is WireGuard-encrypted. The SDS rotation executor uses the tailnet address only (orchestrator ADR-0055 amendment 9). Move infraops' client to the tailnet or put TLS in front, then close the public port. — added 2026-10-14
- [ ] (P3) Deep-link the 4 AM change-window execution report email to the dashboard, same as the 3 AM digest got in PR #23. It's a report of completed work rather than an approve prompt, so lower priority. — added 2026-06-26
- [ ] (P2) Close executor capability gaps surfaced by the manual lane: the secret-rotation class (e.g. veritok-ingest-shared-secret — generate a secret, write to BWS, update a Coolify env var in-place, update the iOS Shortcut bearer token) and local-Mac remediations (chmod a local file) the VPS executor can't do. Decision 2026-06-26: handle via a MANUAL lane (human fixes it; next 3 AM scan auto-resolves), do NOT build a local executor yet — revisit if local-file items recur often. — added 2026-06-26
- [ ] (P2) probe-guard blind spot: internal-only apps (unreachable fqdn, e.g. Watchtower at watchtower.local on dev Coolify) fail the external HTTP probe, so the guard HOLDS them even when they're fully conformant (Watchtower serves /api/health on port 3000, health_check_path/port already set, just health_check_enabled=false). Coolify's health check runs container-internal (127.0.0.1:port), which would pass. Fix: for an unreachable/internal fqdn, probe container-internally (vps_exec on the host) or recognize internal apps, instead of blocking. Surfaced via change-manager item 15. — added 2026-06-27
- [x] (P2) Onboard to code-standards (foundation matrix red: code.not-onboarded) — added 2026-07-02

- [x] (P1) Rotation executor verifies the staged credential before any keeper, quarantine, or consumer write. PR #36 / commit 99e593a reordered the path to read-staged→verify-new→store→deploy→revoke-confirm and added a regression test proving a bad token leaves every consumer untouched. — added 2026-07-02; verified resolved 2026-07-04
- [ ] (P2) The drift-observation CLI's (`src/cli/orchestrator-cli.ts`) fail-open per-instance posting loop, `--dry-run` no-post path, and non-zero exit code now have direct `doObserve` vitest coverage (added in the WS-P3.0 final-review fix wave: client-construction failure, mixed success/failure posting, and skipped-instance visibility are all exercised). Still uncovered: `scripts/drift-audit.sh`'s own consumption of the CLI's exit code and `WARN` line (the shell side of the fail-open contract), and anything exercising the compiled `dist/` output rather than `src/` directly. Originally misfiled in `orchestrator/PROJECT.md` (wrong repo per the per-repo-PROJECT.md convention); moved here and reworded to reflect what remains. — added 2026-07-28
- [ ] (P2) `make check` runs ZERO tests in this repo, by construction: every test step in the vendored polyglot Makefile is gated behind `[ -f pyproject.toml ]`, and this is a TypeScript repo with no `pyproject.toml` — so the only test line (`pytest`) never fires, and `make check` exits 0 having lint/type/format/shellcheck'd but tested nothing. The suite is not actually unguarded (CI runs `npm test` directly, `.github/workflows/build.yml:37`), so this is a LOCAL gate gap: a developer or agent who runs `make check` before declaring work done gets a green that proves no test ran. Same class as the portfolio-wide "`uv sync` installs no extras" and orchestrator's "`make check` exit 0 does not prove the tests ran" invariants. Fix: add a `[ -f package.json ]`-gated `npm test` step to the `check` target. Surfaced by the WS-P3.0 final-review re-review. — added 2026-07-28
- [ ] (P2) make check runs NO TESTS in this repo: the vendored Makefile's only test block is gated on 'pyproject.toml' (pytest), which this repo does not have, so the 524-test vitest suite is never invoked by the gate. eslint, tsc --noEmit, prettier and shellcheck all run correctly; only tests are missed. A contributor running 'make check' gets exit 0 having executed zero tests, which is the portfolio-wide 'exit 0 does not prove tests ran' invariant appearing in its TypeScript form. Fix: add a package.json-gated block running 'npm test' (or vitest run) alongside the pyproject-gated pytest block. Surfaced by the WS-P2.8 Task 10 controller gate run 2026-07-28. — added 2026-07-28
- [ ] (P1) cloudflare_list_pages_projects redaction is incomplete: it masks DROPBOX_APP_SECRET, SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_ANON_KEY but returns GEMINI_API_KEY in plaintext with reveal=false. Redaction should be allowlist-based (mask every deployment_configs/env_vars value unless reveal=true), not keyed on name patterns. — added 2026-08-02
- [ ] (P2) coolify_get_deployment returns the application's Coolify-managed git deploy key unredacted — the full base64 OPENSSH private key appears inline in the logs field, because the deployment log records the 'echo <key> | base64 -d > /root/.ssh/id_rsa' command verbatim. The redactor masks sentinel_token and the git remote in the same response while passing the key through, so partial redaction is not evidence of coverage. The response also exceeds the 25K truncation cap, so the leak lands even when the requested data does not. Second confirmed infraops redaction gap after cloudflare_list_pages_projects (ccdd966e5bf4). Leaked into a transcript 2026-09-10 during FacelessTT outage recovery; that deploy key needs rotating. — added 2026-09-11
- [ ] (P1) Rotate the Resend API key (BWS 56f06eba-925a-4d8e-bfe8-b415015ab8ef, Resend name booking_secured): exposed in a Claude session transcript on 2026-10-23 when Healthchecks' MAILERS setting was printed during the self-hosted Healthchecks API test. Consumers: Healthchecks service o13j4sqwwfyktuuje0qvaa6k (env RESEND_SMTP_PASSWORD), infraops-mcp-server drift-audit.sh and change-window.sh, ops-dashboard, and possibly booking. Give Healthchecks its own send-only key restricted to devonwatkins.com. Devon will handle via SDS after the OVH cutover is complete. — added 2026-10-23
- [ ] (P3) Local make check passes shellcheck SC2317 findings that CI's shellcheck fails (hit twice on 2026-10-25: tests/report-notice.test.sh, tests/change-window.test.sh); align the local and CI shellcheck version or config so the local gate matches CI. — added 2026-10-25
- [ ] (P3) coolify_create_scheduled_task always fails with an opaque 'Validation failed' (tried cron '* * * * *' and 'every_minute'), while a direct POST /api/v1/applications/<uuid>/scheduled-tasks with {name, command, frequency} succeeds; the tool likely sends an extra or wrongly typed field. Fix and surface Coolify's validation errors. Found 2026-10-25. — added 2026-10-25
- [ ] (P3) Porkbun: get_invoice_pdf returns a resource block that skips the 25K CHARACTER_LIMIT truncation in porkbun_read — added 2026-10-30
- [ ] (P3) Porkbun: porkbun_list_tools masks schema properties named password, hiding argument descriptions for two email tools — added 2026-10-30
- [ ] (P3) Redaction over-masks camelCase names like privateKeyId (SECRET_NAME matches privatekey substring) — added 2026-10-30
- [ ] (P3) Redaction masks Porkbun ping's boolean credentialsValid as *** (credentials name match) — added 2026-10-30
- [ ] (P3) Porkbun: a child initialize timeout shows the 'write may have completed' warning, which only applies to tool calls — added 2026-10-30
- [ ] (P2) npm audit on main: 9 transitive vulnerabilities (1 critical proxy-addr, 5 high incl. body-parser, follow-redirects, fast-uri) predating the Porkbun PR — added 2026-10-30
- [ ] (P2) src/change-manager/api-client.ts declares resource_uuid and resource_name non-nullable; change-manager's ADR-0019 Increment 1 migration made that a lie — a deploying-merge record carries resource_name: null (verified in production, item 44). A cross-repo type declaration that no longer matches the server. Found by the ADR-0019 Increment 1 adversarial review, 2026-08-10. — added 2026-10-30
- [ ] (P1) Exempt the orchestrator (eqj5l7k705fhi12x9i74fqf0) from drift rule #570 (health check disabled): its Coolify health check stays off by design (orchestrator CLAUDE.md, migrate-before-swap), and on 2026-10-20 the change window enabled it at port 80 path /, which the image can't answer, so every restart rolled back. Also: the window reported that remediation done although the redeploy failed and Coolify kept the old container; verify the new container, not app status. — added 2026-10-30
## Future plans
