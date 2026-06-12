# Daily drift audit (Mac mini / launchd)

Surfaces Coolify standards drift every day. The audit logic is the same
`coolify_audit_standards` shipped in this MCP server, exposed as a headless CLI
(`dist/cli/audit-cli.js`) and run on a schedule by launchd on the Mac mini —
matching the `vps-backup` operational pattern (launchd + BWS + Healthchecks.io).

## What runs

`scripts/drift-audit.sh` (daily 07:00 via `com.devon.infra-drift`):

1. Sources `~/.config/infra-drift/env` (gitignored) for `BWS_ACCESS_TOKEN` +
   `INFRADRIFT_HC_PING_URL`.
2. Fetches `prod-coolify-api-token`, `local-coolify-api`, `INFRABRAIN_ACCESS_KEY`,
   `resend-api-key` from BWS **by name**.
3. Audits **prod** (`coolify-1.devonwatkins.com`) and **dev** (mini-local OrbStack)
   → writes `~/infra-drift/reports/<date>.json` (proposals + day-over-day delta)
   and `<date>.md`.
4. Emails the markdown digest via Resend.
5. Pings the Healthchecks.io dead-man's switch (`/start`, success, `/fail`).

The JSON lands on the mini for the downstream remediation-planner to consume.

## Install

```bash
bash scripts/install-drift-launchd.sh          # 1st run: creates the env file
$EDITOR ~/.config/infra-drift/env              # fill BWS_ACCESS_TOKEN + INFRADRIFT_HC_PING_URL
bash scripts/install-drift-launchd.sh          # 2nd run: renders plist + loads agent
launchctl start com.devon.infra-drift          # run once now to verify
tail -f ~/Library/Logs/infra-drift.log
```

Secrets live only in `~/.config/infra-drift/env` (chmod 600) — never in this repo
or the plist. The dead-man's switch alerts if a daily run is missed (e.g. mini
offline), so a skipped run never goes unnoticed.
