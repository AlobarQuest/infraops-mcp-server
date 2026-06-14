# Kickoff prompt — Change Manager Plan 3 (mini-side executor)

> Paste the block below into a **fresh** Claude Code session started in `~/Projects/infraops-mcp-server`.
> **Prerequisite:** Plan 2c Part 2 must be done — the `change-manager` app deployed and live at `https://change-mgr.alobar.net`, with its M2M token in BWS. The code below is unit-tested against a mocked API and can be *built* before then, but the live wiring + first run need the deployed app.

---

Build the mini-side of the change manager (the sync step + the 04:00 window executor) by executing:

`docs/superpowers/plans/2026-06-14-change-manager-3-executor.md`

This is code in the `infraops-mcp-server` repo (TypeScript, vitest, the existing `coolify-client`, `@anthropic-ai/sdk`). Execute it **subagent-driven** (fresh subagent per task, two-stage review), the same way Plans 1/2a/2b were built. Branch off `main`; each task is TDD; rebuild + commit the tracked `dist/` at the end; merge to `main` and push.

Tasks 1–6 are pure code (mocked API client / coolify-client / Anthropic) and can be built and verified entirely offline. Pay special attention to:
- **Task 2 (`tools.ts`) — the curated tool surface is the entire blast-radius boundary.** Only HTTPS (`set_application_domains` + `redeploy_application`) and `set_application_healthcheck`, plus read + `report_done`/`report_blocked`. An unknown tool must throw. Review it carefully.
- **Task 3 (`agent.ts`) — the Sonnet tool-use loop** must never throw (failures → `failed`), and must only act through the curated tools. Review the loop's stop conditions (report_done/blocked, maxSteps, tool errors).
- **Task 4 (`run-window.ts`)** — claim 409 → skip without aborting the batch; `MAX_CHANGES_PER_WINDOW` cap; per-item isolation.

If the `@anthropic-ai/sdk` tool-use call shape differs from the plan's code, adapt the SDK mechanics but keep the behavior (loop → curated tools → stop on a control tool); model stays `claude-sonnet-4-6`.

Task 7 wires the launchd scripts + chains `sync` into the daily `drift-audit.sh`. The `BWS_CHANGE_MGR_M2M_SECRET_ID` placeholder must be filled with the real BWS UUID of the change-manager M2M token (created in Plan 2c). The launchd install + first live run are **operational follow-ups to do with me** after the code merges — don't run them autonomously.

After merge, the operational steps (with me): point the mini at the change-manager M2M secret, `bash scripts/install-change-window-launchd.sh` to arm the 04:00 window, then a first run — approve one HTTPS item in the GUI, `launchctl start com.devon.change-window`, and confirm the change lands and the item shows `done` with its tool-call audit. That closes the full loop: audit → remediate (auto-fix safe) → escalate → review/approve → window-execute.
