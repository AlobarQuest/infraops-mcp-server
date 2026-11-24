Outcome: done

# 3k item 7: infraops registry drops localops' tool-installer ops-mini read

PR: PR_PLACEHOLDER. Head SHA: HEAD_PLACEHOLDER. Branch `hq/3k-item7-infraops-registry`, based on
`origin/main` `6d1a451`.

## What I built

Two edits to `.cred-consumers.toml`, both under `bws-tok-ops-mini-20260730`, and nothing else:

- Line 223 (keeper note on the `Claude` / `BWS_ACCESS_TOKEN_VPS_BACKUP` keychain consumer): "and
  localops' tool-installer" becomes "and localops' installers and fork-sync onboard, run
  interactively". The activation sweep's `sds-deadman.sh` on the Mac stays.
- Lines 278-283 at `6d1a451` (the `runtime-fetch` consumer `repo = "localops"`,
  `ref = "scripts/run-tool-installer.sh"`, `healthchecks_check = "sds-tool-installer"`): removed.

Every `[[credential.exposure]]` entry, every `consumers_verified` line, and the
`run-activation-sweep.sh` row are unchanged.

## Step 1: findings at localops main

Read at localops `origin/main` `4f7bd93` ("End the scheduled jobs' Healthchecks-key and sds-bridge
reads (#19)") with `git show` only.

- The run-time read is gone. A count of `BWS_ACCESS_TOKEN|sds-token|sds-bws|51509d5e|b415d03b|find-generic-password`
  is 0 in each of `scripts/run-tool-installer.sh`, `scripts/run-fork-harden.sh`,
  `scripts/run-fork-sync-watch.sh`, and `scripts/sds-deadman.sh`. `sds-deadman.sh` lines 33-37 say
  the ping URL comes from `scripts/healthchecks.toml` and no scheduled pass reads a BWS identity;
  line 49 sets `SDS_DEADMAN_CONFIG` to that file.
- The install-time scripts do read the same Keychain item, so I kept localops in the keeper note,
  named as interactive readers:
  - `scripts/sds-install.sh` lines 44-45 (`sds_upsert_check`) read `Claude` /
    `BWS_ACCESS_TOKEN_VPS_BACKUP` as the broad identity, then fetch the Healthchecks API key at line
    52. `scripts/install-fork-sync-watch-launchd.sh` line 53 calls it.
  - `scripts/install-fork-harden-launchd.sh` lines 55-56 read the same item for its own check.
  - `src/fork_sync/bws.py` lines 25-26 and 40-54 read the same item for `fork-sync onboard`
    (`src/fork_sync/cli.py` line 36). No script or plist under `scripts/` invokes `onboard`, so it
    is a command a person runs.

  Why name them rather than drop localops: a rotation that replaces the keeper's value must still
  leave these readers working, and the note is the only place in the registry that says who reads
  the item. They aren't scheduled and have no Healthchecks check, so they don't get a consumer row.

## Step 3: intent-packages (report only, unchanged)

At intent-packages `origin/main` `00b32ef`,
`packages/rotation-bws-tok-ops-mini-20260730/package.yaml` line 75 still lists
`'runtime-fetch repo="orchestrator" ref="scripts/run-tool-installer.sh"'`. It names the
pre-move orchestrator path, not localops; no line in the file mentions localops, `sds-deadman`, or
the `sds-tool-installer` check. The paired revision drops that destination; that's a follow-up, not
this PR. The registry comment at `.cred-consumers.toml` lines 203-204 already records that the
package's destinations differ from the registry until that revision lands.

## Step 4: does anything in infraops count consumer rows

Nothing does, so the removal is a plain data change:

- `src/security-drift/cred-consumers.ts` line 173 appends each `[[credential.consumer]]` table to
  `consumers`; lines 213-216 check only that each consumer has a `kind`. No count.
- `src/security-drift/cred-rotation.ts` reads `consumers_verified` (lines 342-344) and names "every
  mapped consumer" in checklist prose (line 335). It never reads `consumers` itself.
- `src/cli/security-drift-cli.ts` lines 119, 136, and 175 load the registry; `cred-findings` emits
  findings and `last_rotated`, neither of which carries consumer rows.
- `tests/cred-registry-integration.test.ts` parses the repo's own registry (line 19) and pins the
  credential ids (lines 21-37), not consumer counts. `tests/cred-consumers.test.ts` lines 83 and 111
  count consumers in inline fixtures only. No test or source file in `src/`, `tests/`, or `scripts/`
  names `localops` or `tool-installer`.
- infraops has no rotation-reader verification of its own. The comparison of registry consumers
  with package destinations is the orchestrator's (not read here, per the stop points).

## Tests and checks

- `make check`: exit 0. Vitest collected 60 test files and 694 tests, all passed. (The first run
  stopped at "tsc not found"; `npm ci` in the worktree fixed it.)
- `code-standards risk --repo .`: `normal`, so no vendor review.
- `npx prettier --check` on this report: passes.
- CI: CI_PLACEHOLDER

## Files changed

- `.cred-consumers.toml`
- `docs/superpowers/reports/3k-item7-infraops-registry-report.md`

## Self-review

The diff is one note rewrite and one removed table, confirmed with `git diff`. The file still parses
(the integration test reads it). I didn't run `/code-review`: the change is registry data with no
logic, and the handoff expects no code change.

## Concerns

- The keeper note names `fork-sync onboard` beyond what the handoff suggested. It reads the same
  Keychain item (`src/fork_sync/bws.py` lines 25-26), so leaving it out would understate the
  readers. HQ can trim it if it wants the narrower wording.
- The rotation package still lists the orchestrator `run-tool-installer.sh` destination (step 3).

## Standards followed

- Code Brain 3 (structured JSON logs to stdout): not applicable; no code changed.
- Code Brain 4 (never silently swallow an exception): not applicable; no code changed.
- Code Brain 5 (never log secrets, credentials, tokens): no value was read or written. I made no BWS
  calls and no infraops MCP calls; the localops reads were source text only.
- Infra Brain 591 `bws.no-token-in-tracked-files`: the diff and this report hold no token-shaped
  string; they name Keychain items and secret UUID prefixes already in the source.
- Infra Brain 592 `bws.no-token-in-git-history`: the commit adds no token-shaped string.
- Infra Brain 593 `bws.bootstrap-token-not-inline`: no token is assigned inline anywhere in the
  change.
- Infra Brain 1032 `cred.exposure-rotate`: the registry stays this repo's `.cred-consumers.toml`; no
  `[[credential.exposure]]` entry was added or removed, and `consumers_verified` is unchanged.
- Infra Brain 212 (HTTPS): not applicable.
