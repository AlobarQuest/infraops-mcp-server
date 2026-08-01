# Kickoff prompt — Change Manager Plan 2c **Part 2** (live deploy)

> Paste the block below into a **fresh** Claude Code session started in `~/Projects/infraops-mcp-server`.
> This is a dedicated **infrastructure-mutation** session (prod Coolify, DNS, Authentik, BWS) — keep it separate from build/research work, and keep approval gates on.

---

I want to deploy the `change-manager` web app to production. The app code, Dockerfile, and CI are already built and on GitHub (`AlobarQuest/change-manager`, `main`); Part 1 of the deploy plan is done. Now execute **Part 2 (the deployment runbook)** of:

`docs/superpowers/plans/2026-06-14-change-manager-2c-deploy.md`

Before doing anything, read: that plan's Part 2, the design spec `docs/superpowers/specs/2026-06-14-change-manager-design.md`, the **sso-integration** skill (forward-auth recipe, §7), and confirm the infra-brain BLOCK rules still hold (`get_rules severity=BLOCK`).

Work the runbook **step by step (Tasks 3–7), pausing for my confirmation at each checkpoint** — this is prod and most steps are hard to reverse. Use the **infraops MCP `coolify_*` tools** for all Coolify changes (never curl/SSH/UI for what infraops can do), the **sso-integration** skill for the Authentik provider/outpost, **BWS** for every secret (by stable UUID; nothing committed), and the **namecheap/cloudflare** infraops tools for DNS.

Critical correctness points from the plan to honor:

- **Domain `change-mgr.alobar.net`** (SSO forward-auth convention) — confirm with me before creating the DNS record.
- **Forward-auth on the GUI paths only; `/api/*` must stay reachable for the mini's M2M token** — implement the two-router Traefik split in the plan.
- **Mandatory safety:** strip spoofed `X-authentik-*` headers at the edge; the app container must NOT publish a host port (internal Docker network only); run the **header-spoof negative test** before declaring done.
- Migrations run at container startup (already in the entrypoint); the Coolify deploy webhook fires only after the GHCR push.

When done, run the full end-to-end verification (Task 7): GUI SSO login works, the spoof test fails closed, the mini's M2M `/api/items` call still returns 200, and a synced item can be approved in the GUI with my email recorded as `decided_by`. Then onboard the app to app-brain.

After this is complete and verified, the next step (a _separate_ session) is Plan 3 — the mini-side executor — using the kickoff at `docs/superpowers/kickoffs/change-manager-3-executor.md`.
