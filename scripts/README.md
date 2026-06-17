# Daily drift audit + remediation pipeline (Mac mini / launchd)

Surfaces Coolify standards drift every day, auto-applies safe fixes, and produces
a remediation plan for everything that needs human sign-off. The audit logic is the
same `coolify_audit_standards` shipped in this MCP server, exposed as headless CLIs
(`dist/cli/audit-cli.js`, `dist/cli/remediate-cli.js`) and run on a schedule by
launchd on the Mac mini — matching the `vps-backup` operational pattern (launchd +
BWS + Healthchecks.io).

## What runs

`scripts/drift-audit.sh` (daily 03:00 via `com.devon.infra-drift`):

1. Loads `BWS_ACCESS_TOKEN` from the macOS login Keychain (service `Claude`, account
   `BWS_ACCESS_TOKEN_INFRA_DRIFT`, via `bws-token.sh`) — never from a plaintext file.
   Sources `~/.config/infra-drift/env` (gitignored) only for `INFRADRIFT_HC_PING_URL`.
2. Fetches every secret from BWS **by stable UUID** (per infra-brain lesson #277 —
   names are mutable, UUIDs are stable), each defaulted inline and overridable via
   a `BWS_*_SECRET_ID` env var:
   - prod Coolify token (`prod-coolify-api-token`) — `BWS_PROD_COOLIFY_SECRET_ID`
   - dev Coolify token (`local-coolify-api`) — `BWS_DEV_COOLIFY_SECRET_ID`
   - infra-brain key (`INFRABRAIN_ACCESS_KEY`) — `BWS_INFRABRAIN_SECRET_ID`
   - Resend key (`resend-api-key`) — `BWS_RESEND_SECRET_ID`
   - Anthropic key (`anthropic-api-key`) — `BWS_ANTHROPIC_SECRET_ID`

   The Anthropic key is used only for plan generation; the deterministic
   safe-apply path needs no model.
3. Audits **prod** (`coolify-1.devonwatkins.com`) and **dev** (mini-local OrbStack)
   → writes `~/infra-drift/reports/<date>.json` (proposals + day-over-day delta)
   and `<date>.md`.
4. **Remediate:** `remediate-cli.js` re-audits live, auto-applies `safe`
   remediations (idempotent re-check before each write; never more than
   `MAX_AUTO_APPLIES`, default 20). A `safe` item can still be **held back** by a
   pre-apply verify gate: `coolify.enable_healthcheck` only auto-applies when the
   app is currently `running:healthy` (proof it serves a health endpoint) —
   otherwise it's escalated with an "Auto-fix held" note so a working app isn't
   marked unhealthy by a check pointed at a path it doesn't serve. For every
   `caution`, `destructive`, `question`, and verify-held item it asks Sonnet
   (`claude-sonnet-4-6`) to write a remediation plan.
   Writes `~/infra-drift/reports/<date>.remediation.json` (machine record + the
   `escalations` change-manager contract) and `<date>.remediation.md`.
5. Emails the **consolidated** digest (`<date>.remediation.md`) via Resend, falling
   back to the raw audit `<date>.md` if the remediation step hard-failed.
6. Pings the Healthchecks.io dead-man's switch (`/start`, success, `/fail`).
   The heartbeat is healthy only if BOTH the audit and remediate steps succeed.

## Dry run

Preview without writing or emailing:
`node dist/cli/remediate-cli.js --instance prod --dry-run`

## Future: change manager

The `escalations` array in `<date>.remediation.json` is a stable, versioned
(`schema_version`) contract for a later change-manager process that implements the
hard fixes during change-management windows. This pipeline only produces the
package; it never auto-applies escalated items.

## Install

```bash
# One-time: put the BWS token in the login Keychain (paste at the prompt — never echo it)
security add-generic-password -U -s Claude -a BWS_ACCESS_TOKEN_INFRA_DRIFT -T /usr/bin/security -w

bash scripts/install-drift-launchd.sh          # 1st run: creates the env file
$EDITOR ~/.config/infra-drift/env              # fill INFRADRIFT_HC_PING_URL
bash scripts/install-drift-launchd.sh          # 2nd run: renders plist + loads agent
launchctl start com.devon.infra-drift          # run once now to verify
tail -f ~/Library/Logs/infra-drift.log
```

The BWS token lives only in the login Keychain (account `BWS_ACCESS_TOKEN_INFRA_DRIFT`);
`~/.config/infra-drift/env` (chmod 600) holds only the Healthchecks ping URL(s) — never
the token, and never anything in this repo or the plist. The dead-man's switch alerts if
a daily run is missed (e.g. mini offline), so a skipped run never goes unnoticed.
