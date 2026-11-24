Outcome: done

# Report: re-point infraops' tool-installer consumer of `bws-tok-ops-mini-20260730` to localops

Worker W-292. Branch `hq/3k-item5-tool-installer-row`, base `8dc4d43`. PR
[#175](https://github.com/AlobarQuest/infraops-mcp-server/pull/175) is open and ready (not a draft)
and not merged. The code commit is `a7614c9`. The PR's head is the commit that adds this report.

## What I built

One consumer row in `.cred-consumers.toml`, under `id = "bws-tok-ops-mini-20260730"`, lines
340-345:

- `repo = "orchestrator"` became `repo = "localops"`.
- `ref = "scripts/run-tool-installer.sh"` is unchanged.
- `healthchecks_check = "sds-tool-installer"` is unchanged, because localops still pings that
  check with this token (step 1).
- `note` became: "launchd com.devon.tool-installer 03:15 on the Mac; localops' sds-deadman.sh
  reads Keychain Claude/BWS_ACCESS_TOKEN_VPS_BACKUP each armed run to find its check by name (a
  --dry-run pass doesn't arm), so without a working token the check isn't pinged".

No other line in the file changed.

## Step 1: what localops reads

All citations are at localops `origin/main` `4360c0c`, read with `git show`:

- `scripts/run-tool-installer.sh` line 82 sources `scripts/sds-deadman.sh`, and line 83 runs
  `sds_deadman_arm sds-tool-installer --finding 3 "$@"`.
- `scripts/sds-deadman.sh`:
  - Lines 339-343: `sds_deadman_arm` returns before resolving on a `--dry-run` pass. Otherwise it
    calls `sds_deadman_resolve`.
  - Lines 126-129: the UUID path applies only when `SDS_DEADMAN_PING_URL_UUID` is set. Nothing in
    localops outside `sds-deadman.sh` sets it.
  - Lines 130-131: otherwise it reads `BWS_ACCESS_TOKEN_BROAD`, or Keychain `-s 'Claude' -a
    'BWS_ACCESS_TOKEN_VPS_BACKUP'`.
  - Lines 137-165: it uses that token to read the Healthchecks API key (UUID line 75), lists the
    checks, and matches the exact name.
- `scripts/com.devon.tool-installer.plist` lines 25-40: label `com.devon.tool-installer`, arguments
  `run-tool-installer.sh --install`, at 03:15.
- Registry line 200: `keeper_account = "BWS_ACCESS_TOKEN_VPS_BACKUP"`, so that Keychain item holds
  this credential.

## Step 2: does anything require `repo` to be a known repository?

No:

- `src/security-drift/cred-consumers.ts:31`: `repo?: string`, an optional free string.
- `src/security-drift/cred-consumers.ts:214-215`: the loader's only consumer check is that `kind`
  is present.
- Greps across `src/`, `tests/`, and `scripts/` found no repository allowlist. No code reads a
  consumer's `.repo`, and nothing names `localops` or `tool-installer`.
- `tests/cred-registry-integration.test.ts` lines 18-50 check credential ids, attestation, and
  age routing, not consumer repos.

No code change was needed, so I wrote no question file.

## Step 3: other rows, the package, and the due date (reported, not changed)

**Launchers missing at orchestrator `origin/main` (`3fa5be9b`).** I checked every orchestrator
`ref` under this credential with `git cat-file -e`. Only `scripts/run-tool-installer.sh` is
missing. The other 11 exist.

**Lanes that moved to the VPS.** I used the orchestrator #788 report
(`docs/superpowers/reports/lanes-inc-6-retire-mac-plumbing-report.md`):

- Lines 16-21 list the 15 moved lanes.
- Line 25 keeps `com.devon.activation-sweep` on the Mac.

I also read each launcher's container guard. Ten rows under this credential name moved lanes:

| Row (registry lines) | Launcher guard line | Dead-man line |
|---|---|---|
| bump-proposer (277-282) | 170 | 189-190 (`sds_outcome_begin`) |
| change-proposer (284-289) | 84 | 100-101 (`sds_outcome_begin`) |
| deploy-watcher (291-296) | 56 | 65 |
| estate-landing (298-303) | 109 | 120 |
| inert-landing (305-310) | 114 | 124 |
| landing-ledger (312-317) | 42 | 51 |
| pin-watcher (319-324) | 53 | 63 |
| revision-watcher (326-331) | 60 | 71 |
| rotation-proposer (333-338) | 113 | 122 |
| work-carrier (347-352) | 147 | 164-165 (`sds_outcome_begin`) |

Each guard refuses outside the lane's container ("FATAL: no BWS_ACCESS_TOKEN: the <lane> lane runs
only in its container, through lane-run"). In its container, a lane resolves its ping URL through
`SDS_DEADMAN_PING_URL_UUID` with its own lane token (ADR-0059 lines 720-723; orchestrator
`sds-deadman.sh` line 147). So these ten rows' note, "sds-deadman.sh reads
BWS_ACCESS_TOKEN_VPS_BACKUP each run", no longer holds. As far as I can tell, these lanes no longer
read this credential.

`run-activation-sweep.sh` (registry lines 270-275) stays on the Mac. Its line 112 arms the dead-man
switch, and orchestrator `sds-deadman.sh` lines 151-152 still read
`BWS_ACCESS_TOKEN_VPS_BACKUP`. That row is current.

**The 2026-11-22 plist backup note.** I couldn't find it. The #788 report's only "backup" mention
(line 143) is a mutation test that backed up `com.devon.rotation-worker.plist`. The PR #788 body
and comments contain no plist backup note. The lane evidence in the preceding table comes from the
report's lines 16-27 and the launcher guards.

**intent-packages.** `packages/rotation-bws-tok-ops-mini-20260730/package.yaml` at
`origin/main` `00b32ef` (revision 1):

- Line 75, `'runtime-fetch repo="orchestrator" ref="scripts/run-tool-installer.sh"'`, is the only
  destination line that now differs from the registry. The registry says `repo="localops"`.
- Lines 65-76 still list the ten moved lanes' rows. Those match the registry, because neither has
  changed.
- The prose at lines 35-38 and 51 says the token verifies "every orchestrator lane by its
  Healthchecks check". That predates the move.

**Next due date.** I ran `node dist/cli/security-drift-cli.js cred-findings --now <date>`. For
this credential it returns nothing at `2027-07-29T12:00:00Z` and `cred.rotation-age` (anchor
`2026-07-30`) at `2027-07-30T12:00:00Z`. The anchor is `created`, and no rotation is recorded in
the state file. The machine-token class allows 365 days (`src/security-drift/cred-rotation.ts:89-90`).
That CLI reads the registries named in `~/.config/infra-drift/cred-consumers.list`, which names the
main checkout's `.cred-consumers.toml`, not this worktree's. The `created` field is the same in
both. No finding is due today.

## Step 4: exposures and `consumers_verified`

Unchanged. No test required a change to either.

## Tests and checks run

- **`make check`**: exit 0. 60 vitest files, 694 tests passed. The shell tests printed 57 `ok`
  lines and no failures.
- **Security scan** (`security_scan.cli . --category security`, from the repository root): 0 BLOCK,
  6 WARN, 1 INFO. None comes from this diff, which adds no secret file or UUID.
- **`code-standards risk --repo .`**: `normal`, so no vendor review is needed.
- **`/code-review`**: I didn't run it. The diff is one data row, two changed lines and no logic,
  and I checked each changed value against the localops source lines cited in step 1. HQ's review
  covers the PR.

## Files changed

- `.cred-consumers.toml` (2 lines).
- `docs/superpowers/reports/3k-item5-infraops-row-repoint-report.md` (this report).

## Self-review

- The row still parses, and `make check` loads the repository's own registry
  (`tests/cred-registry-integration.test.ts`).
- I kept `ref` as `scripts/run-tool-installer.sh`. That path exists at localops `origin/main`.
- The note names a Keychain item and a check, never a value.

## Concerns

1. **Registry line 203 is false after this change.** It says package revision 1 "lists exactly
   these destinations". The registry and package now differ at the tool-installer row until the
   paired intent-packages revision lands. I left it, as the handoff limits me to the one row.
2. **The keeper note at registry line 222 is stale.** It says the keeper is read by "every
   orchestrator lane's sds-deadman.sh". After ADR-0059 increment 6, only the activation sweep's
   is, plus localops' tool-installer.
3. **Ten stale rows.** The ten moved-lane rows in step 3 probably no longer read this credential.
   If they stay, the rotation's reader verification checks Healthchecks checks that ping with lane
   tokens, not with this one. This is the same risk the #788 report raised for
   `bws-sds-operator-token` (its open item 1). Removing them changes this registry and the package
   together, so it needs Devon's decision.
4. **I ran `git fetch`** in `~/Projects/orchestrator`, `~/Projects/localops`, and
   `~/Projects/intent-packages` to make sure `origin/main` was current before reading it. A fetch
   updates only remote-tracking refs: no working tree, branch, or checkout changed. The handoff
   named read-only `git show` for localops, and the worker rules forbid pulling orchestrator, so
   I'm disclosing it. Orchestrator's `origin/main` read `3fa5be9b`, the commit the handoff names.
5. **Not covered by the handoff's standards section:** none.

## Standards followed

- **Code Brain rule 3 (structured JSON logs to stdout).** Not applicable: no code or log line
  changed.
- **Code Brain rule 4 (never silently swallow an exception).** Not applicable: no code changed. No
  handler or `|| true` was added.
- **Code Brain rule 5 (never log secrets, credentials, tokens).** The new note names a Keychain
  service and account and a check name only. I read no secret value and made no BWS call.
- **Infra Brain 591 `bws.no-token-in-tracked-files`.** The diff and this report contain no
  token-shaped string. The security scan reports 0 BLOCK.
- **Infra Brain 592 `bws.no-token-in-git-history`.** The commit adds no token. The scan, which
  covers history, reports 0 BLOCK.
- **Infra Brain 593 `bws.bootstrap-token-not-inline`.** No inline `BWS_ACCESS_TOKEN` assignment was
  added anywhere.
- **Infra Brain 1032 `cred.exposure-rotate`.** The registry stays this repository's
  `.cred-consumers.toml`. I added and removed no `[[credential.exposure]]` entry and left
  `consumers_verified` unchanged. I saw no secret value, so nothing needs rotating.
- **Infra Brain 212 (HTTPS).** Not applicable: nothing is served and no FQDN changed.
