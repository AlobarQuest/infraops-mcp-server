# Send infraops alerts and reports through alert-hub

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The three urgent security alerts and the two daily reports (drift audit 03:00, change
window 04:00) go to Devon through alert-hub (`https://alerts.alobar.net`) instead of Resend, with
Resend kept as the fallback until the hub path is proven live.

**Architecture:** Vendor alert-hub's dependency-free helpers: `src/alert-hub.ts` (TypeScript) and
`scripts/alert-hub-send.sh` (shell). `notify.ts` sends through the hub when `ALERT_HUB_TOKEN` is
set and through Resend otherwise. The two wrappers send their report as an alert-hub *notice* when
`ALERT_HUB_REPORT_TOKEN` is set and through Resend otherwise. A follow-up plan removes Resend once
both paths are verified live.

**Tech stack:** TypeScript (vitest), bash, launchd on the Mac mini.

**Spec:** alert-hub `docs/superpowers/specs/2026-10-24-alert-hub-design.md` (Phase 3) and
`docs/sender-guide.md` in `~/Projects/alert-hub`.

## Global constraints

- **Senders:** `infraops` for the urgent alerts (token env `ALERT_HUB_TOKEN`) and
  `report-infraops` for the reports (token env `ALERT_HUB_REPORT_TOKEN`).
- **Tokens:** never logged, never in argv. The wrappers fetch them from BWS by UUID with
  `--color no`, like `RESEND_API_KEY` today. The UUIDs come from `~/.config/infra-drift/env` as
  `BWS_ALERT_HUB_TOKEN_ID` and `BWS_ALERT_HUB_REPORT_TOKEN_ID`. When an ID is unset, the token is
  unset and the Resend path runs, so this change ships with no behavior change.
- **Hub limits:** title ≤ 200 characters; an alert's message ≤ 4,000; a notice's message ≤ 12,000.
  Over the limit, the hub answers 400 and the message is lost, so the sender cuts it first.
- **Both helpers are copied verbatim** from `~/Projects/alert-hub/clients/typescript/alertHub.ts`
  and `~/Projects/alert-hub/clients/alert-hub-send.sh`, with a first-line comment naming the source
  file and the alert-hub commit `af458ab`. Don't edit their logic.
- **`dist/` is tracked:** every `src/` change runs `npm run build` and commits the matching
  `dist/` files in the same commit. CI's Build workflow fails a stale `dist/`.
- Best-effort and non-fatal, as today: a failed send logs one line and never fails the run.

## Review focus

1. A report over 12,000 characters (the remediation digest is about 12,600 today): cut to fit, with
   a last line saying it was cut and where the full file is.
2. Hub down or token wrong: the helper returns false. The urgent path must then try Resend, so an
   urgent alert is never lost to a hub outage during the transition.
3. An urgent body over 4,000 characters: cut with a pointer to change-manager.
4. Two urgent runs on one day with different items: they must not collapse into one open alert, so
   the key includes the date and the escalation ids.
5. A token in a log line or in `ps` output: never.

---

### Task 1: Vendor the helpers

**Files:** create `src/alert-hub.ts` and `scripts/alert-hub-send.sh`.

- [ ] Copy both files verbatim as described in the global constraints. Make the script executable.
- [ ] Commit: `chore: vendor alert-hub sender helpers (alert-hub af458ab)`.

### Task 2: Urgent alerts through the hub

**Files:** modify `src/security-drift/notify.ts`, `src/cli/security-drift-cli.ts`,
`src/cli/change-mgr-cli.ts`. Test: `tests/security-drift-notify.test.ts` (or the repo's existing
notify test file).

**Interfaces:**
- `NotifyDeps` gains `hubToken?: string` and `hubUrl?: string`.
- `sendUrgentAlert(key: string, title: string, text: string, deps: NotifyDeps): Promise<boolean>`
  replaces `sendAlertEmail`. It sends `{ key, severity: 'critical', status: 'firing', title,
  message }` through `sendAlert` when `deps.hubToken` is set. When the hub send returns false, or
  no token is set, it falls back to the existing Resend send with `title` as the subject.
- `sendUrgentEmail(items, deps)` keeps its name and behavior but calls `sendUrgentAlert` with the
  key `security-urgent:<YYYY-MM-DD>:<sha256 of the sorted escalation ids, first 8 hex>`.

Call sites:
- Version skew (`security-drift-cli.ts` about line 240): key `security-drift-version-skew`.
- Urgent escalations (about line 285): through `sendUrgentEmail`.
- Integrity refusal (`change-mgr-cli.ts` about line 146): key
  `security-executor-refused:<item.id>`.

Each builds `NotifyDeps` with `hubToken: process.env.ALERT_HUB_TOKEN`.

- [ ] Tests, written first:
  - With `hubToken` set, one `fetch` to `https://alerts.alobar.net/v1/alerts` carrying the key,
    `critical`, the title and the message. No Resend call.
  - With `hubToken` set and the hub answering 500, a Resend call follows.
  - With no `hubToken`, only the Resend call, unchanged from today.
  - A 6,000-character body arrives at the hub as at most 4,000 characters, ending with
    `… (cut; full list at https://change-mgr.alobar.net)`.
  - Two escalation sets on the same date produce different keys; the same set produces the same
    key.
  - The token never appears in any log output (spy on console).
- [ ] Implement, run `make check`, commit: `feat: send urgent security alerts through alert-hub`.

### Task 3: Daily reports as notices

**Files:** modify `scripts/drift-audit.sh`, `scripts/change-window.sh`. Create
`scripts/lib/report-notice.sh` with the shared cut-and-send function, replacing the copied Resend
block in each script. Test: `tests/report-notice.test.sh` (or the repo's shell-test convention),
wired into `make check`.

**Interface:** `send_report <key> <subject> <body-file> <full-path-for-footer>`, sourced by both
scripts:
- With `ALERT_HUB_REPORT_TOKEN` set: cut the body to 12,000 characters, ending with
  `\n\n… (cut at 12,000 of N characters; full report: <full-path-for-footer> on the Mac mini)`.
  Then run `alert-hub-send.sh --notice -- <key> info <subject> <body>`. On failure, fall through
  to Resend.
- Otherwise, the existing Resend send, unchanged.
- Keys: `report:infra-drift:<DATE>` and `report:change-window:<DATE>`.
- Count characters, not bytes: the reports contain emoji.

Token fetch: next to the existing `RESEND_API_KEY` fetch in each wrapper, fetch `ALERT_HUB_TOKEN`
(drift only, for the TypeScript CLIs) and `ALERT_HUB_REPORT_TOKEN` from their `BWS_*_ID`
variables when set, and export them. Never echo them.

- [ ] Tests, written first: a 20,000-character body with emoji is sent as at most 12,000
      characters with the footer; a short body is sent whole; with no token, the Resend branch runs
      (stub `curl` and `alert-hub-send.sh` on `PATH`).
- [ ] Implement, run `make check` (shellcheck included), commit:
      `feat: send daily reports to alert-hub as notices`.

### Task 4: Docs

- [ ] Add a short section to the repo's operations docs (where the drift and change-window jobs are
      described) naming the two senders, the two env-file variables, and the fallback rule. Commit.

### Task 5: Cutover (needs the tokens in BWS; the controller does this)

- [ ] Create senders `infraops` and `report-infraops` (expected interval 26 hours) in alert-hub,
      store their tokens in BWS, and set both UUIDs in `~/.config/infra-drift/env`.
- [ ] Run each wrapper once by hand, or wait for the 03:00 and 04:00 runs, and confirm the notices
      in the hub's History. Trigger one test urgent alert through `sendUrgentAlert` and confirm it.
- [ ] Follow-up plan: remove the Resend fallback.
