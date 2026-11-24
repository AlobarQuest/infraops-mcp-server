Outcome: done

# Report: 3k item 5, drop the moved lanes' ops-mini consumer rows

- PR: #176 (https://github.com/AlobarQuest/infraops-mcp-server/pull/176)
- Head SHA: `6f9a287` carries the change; the follow-up commit fills in this report's PR number and CI result
- Base: `origin/main` `bbe7d93`
- Orchestrator read at `origin/main` `ef463b44`; intent-packages read at `origin/main` `00b32ef`

## What I built

I removed ten `[[credential.consumer]]` rows from `bws-tok-ops-mini-20260730` in
`.cred-consumers.toml` and fixed two stale lines in the same credential. Nothing else changed.

### Rows removed, with their source lines

Each lane passes both checks at orchestrator `origin/main`:

- (a) its launcher exits 1 before it sources `scripts/sds-deadman.sh` when it holds no
  `BWS_ACCESS_TOKEN` (the container guard).
- (b) its lane compose sets `SDS_DEADMAN_PING_URL_UUID`, so `sds_deadman_resolve` takes the uuid
  branch (`scripts/sds-deadman.sh` 147-149) and returns before the Keychain
  `BWS_ACCESS_TOKEN_VPS_BACKUP` fallback (151-152).

| Lane              | Launcher guard (`scripts/run-<lane>.sh`) | Resolve call            | Compose (`lanes/<lane>/compose.yaml`) |
| ----------------- | ---------------------------------------- | ----------------------- | ------------------------------------- |
| bump-proposer     | 169-171                                  | 190 `sds_outcome_begin` | 29 `BWS_ACCESS_TOKEN`, 32 uuid        |
| change-proposer   | 83-85                                    | 101 `sds_outcome_begin` | 21 `BWS_ACCESS_TOKEN`, 23 uuid        |
| deploy-watcher    | 55-57                                    | 65 `sds_deadman_arm`    | 20 `BWS_ACCESS_TOKEN`, 22 uuid        |
| estate-landing    | 108-110 (`sds_in_lane_container`)        | 120 `sds_deadman_arm`   | 34 uuid, 37 broker socket mount       |
| inert-landing     | 113-115 (`sds_in_lane_container`)        | 124 `sds_deadman_arm`   | 30 uuid, 33 broker socket mount       |
| landing-ledger    | 41-43                                    | 51 `sds_deadman_arm`    | 19 `BWS_ACCESS_TOKEN`, 21 uuid        |
| pin-watcher       | 52-54                                    | 63 `sds_deadman_arm`    | 22 `BWS_ACCESS_TOKEN`, 25 uuid        |
| revision-watcher  | 59-61                                    | 71 `sds_deadman_arm`    | 23 `BWS_ACCESS_TOKEN`, 26 uuid        |
| rotation-proposer | 112-114                                  | 122 `sds_deadman_arm`   | 31 `BWS_ACCESS_TOKEN`, 34 uuid        |
| work-carrier      | 146-148                                  | 165 `sds_outcome_begin` | 30 `BWS_ACCESS_TOKEN`, 33 uuid        |

Estate-landing and inert-landing are broker lanes: their guard is `sds_in_lane_container`
(`scripts/sds-bws.sh` 113-115), which holds when the lane has a token or a mounted secrets-broker
socket, and their compose maps no token. The guard is still the container guard, and the uuid in
their compose keeps them off the Keychain fallback, so both rows qualify. No lane failed a check.

### Rows kept unchanged

- `orchestrator` `scripts/run-activation-sweep.sh` (Mac job, still reads the token by name).
- `localops` `scripts/run-tool-installer.sh` (re-pointed in #175).

### Lines fixed

- The handover comment (was line 203): it said package revision 1 "lists exactly these
  destinations". It now says the package's destinations differ from this registry until its paired
  revision lands, before the next rotation.
- The keeper note on `Claude/BWS_ACCESS_TOKEN_VPS_BACKUP` (line 222): "among them every
  orchestrator lane's sds-deadman.sh" now reads "among them the activation sweep's sds-deadman.sh
  on the Mac and localops' tool-installer".

## Step 4: what in infraops reads the consumer rows

Nothing in infraops counts consumers or treats a removed row differently.

- `src/security-drift/cred-consumers.ts` 173 appends each `[[credential.consumer]]` table to
  `cred.consumers`; 213-216 reject a consumer with no `kind`. Those are the only reads of
  `consumers` in `src/`.
- `src/security-drift/cred-rotation.ts` reads no consumer row. 342-344 reads only
  `consumers_verified`, adding the line "Consumer set not attested" to the manual checklist when it
  is missing. This credential has no `consumers_verified` and is `rotated_by_sds = true`, so it gets
  no checklist; both stay as they were.
- `src/cli/security-drift-cli.ts` (`cred-findings`) reports findings and `last_rotated`, not
  consumers.
- Tests: `tests/cred-registry-integration.test.ts` 26 lists the credential id, and 36-37 require
  `consumers_verified` only for the three leaked credentials. `tests/cred-consumers.test.ts` 83 and
  111 count consumers of inline fixtures, not the registry. No test needed a change.
- The rotation's reader verification is in the orchestrator, outside infraops; I didn't assess it.

The credential has no `[[credential.exposure]]` entry; none was added or removed.

## Step 5: intent-packages destinations that now differ (not changed)

In `packages/rotation-bws-tok-ops-mini-20260730/package.yaml` (revision 1) at intent-packages
`origin/main` `00b32ef`, the following destination lines name consumers the registry no longer has:

- 66 `run-bump-proposer.sh`
- 67 `run-change-proposer.sh`
- 68 `run-deploy-watcher.sh`
- 69 `run-estate-landing.sh`
- 70 `run-inert-landing.sh`
- 71 `run-landing-ledger.sh`
- 72 `run-pin-watcher.sh`
- 73 `run-revision-watcher.sh`
- 74 `run-rotation-proposer.sh`
- 76 `run-work-carrier.sh`

Line 75 names `repo="orchestrator" ref="scripts/run-tool-installer.sh"`; the registry has named it
`repo="localops"` since #175. Every other destination (lines 60-65 and 77-81) matches a registry row.

## Tests and checks

- `make check`: exit 0. Vitest collected and passed 694 tests in 60 files; the shell suites printed
  only `ok` lines. The first run stopped on `tsc not found`; `npm ci` fixed it.
- `code-standards risk --repo .`: `normal`, so no vendor review.
- `npx prettier --check` on this report: passes.
- CI `Quality` on the PR head: passed on `6f9a287` (runs 45427182898 and 45427133196, collecting 694 tests in 60 files); `Build` passed (run 45427182775).
- No `src/` change, so `dist/` is unchanged.

## Files changed

- `.cred-consumers.toml`: ten rows removed, two lines fixed (3 insertions, 72 deletions).
- `docs/superpowers/reports/3k-item5-stale-ops-mini-rows-report.md`: this report.

## Self-review

- I matched each removed block exactly (ref, check name, and the shared note) and asserted one
  match per lane, so no other row moved.
- The registry still parses: the integration test loads it and passes.
- The keeper note keeps its other readers word for word.

## Concerns

1. The registry and the approved package revision 1 disagree on 11 destinations until the paired
   intent-packages revision lands. That revision must land before the credential's next rotation
   (due from 2027-07-30), as HQ decided.
2. I ran `git fetch` in `~/Projects/orchestrator` and `~/Projects/intent-packages` to read
   `origin/main`. It updated remote-tracking refs only; I didn't check out, pull, or edit either
   tree.
3. The checks cover the launchers and composes as written. Whether a Mac launchd job for any of the
   ten lanes still exists is outside them; if one does, its launcher refuses at the guard before
   it reads the token.

## Standards followed

- Code Brain 3 (structured JSON logs), 4 (never swallow an exception), 5 (never log secrets): no
  code changed, so none applies to the diff.
- Infra Brain 591 `bws.no-token-in-tracked-files`, 592 `bws.no-token-in-git-history`, 593
  `bws.bootstrap-token-not-inline`: the diff and report hold no token-shaped string. The
  report cites compose line numbers, not secret ids or values; I read no secret and made no BWS
  call.
- Infra Brain 1032 `cred.exposure-rotate`: the registry stays in this repo's `.cred-consumers.toml`;
  no `[[credential.exposure]]` entry was added or removed, and `consumers_verified` is unchanged
  (this credential has none).
- Infra Brain 212 (HTTPS): not applicable.
