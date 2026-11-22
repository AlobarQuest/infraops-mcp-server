Outcome: done

# Report: infra-drift stops minting follow-up units

Worker W-260. Branch `hq/infraops-drop-follow-up-mint`, base `origin/main` at `68c4af5` (the
handoff's line references matched that base). PR
[#173](https://github.com/AlobarQuest/infraops-mcp-server/pull/173), ready, not merged. The code
commit is `0ffa1d1`; this report is the commit after it.

This is item 9 of the follow-up minting cut-over list in orchestrator `docs/operations/deploy.md`
(ADR-0059 increment 9, Amendment 10, step 3j-inc-9): "The infraops-mcp-server pull request
removing `drift-audit.sh`'s minting step, with its `BWS_ACCESS_TOKEN_SDS` Keychain read for the
bearer." HQ merges it after verifying the `follow-up-mint` lane's 06:43 scheduled pass.

## What I built

1. `scripts/drift-audit.sh`: deleted base lines 152-181, the whole "Best-effort: run one follow-up
   minting pass" block: its comment, the `ORCHESTRATOR_MINT_TOKEN` export with the
   `security find-generic-password … BWS_ACCESS_TOKEN_SDS` read, the
   `ORCHESTRATOR_MINT_CREDENTIAL_KEY_ID` export, the `mint-follow-ups` call, its two log lines,
   and the trailing blank line. The observation step (lines 138-150) and the security-drift step
   that follows are byte-for-byte unchanged. No other line in the script refers to the removed
   block: the script has no step count, and the only "orchestrator" lines left belong to the
   observation step and the unrelated rotation-executor comment at line 120.
2. Dead code removed after confirming no caller:
   - `src/cli/orchestrator-cli.ts`: removed the `makeMintClient`/`doMintFollowUps` doc comment and
     functions (base 63-105) and the `mint-follow-ups` dispatch branch (base 168-169). The
     unknown-command error now reads `(use observe)`, which is true.
   - `src/orchestrator/api-client.ts`: removed `FollowUpMintResponse` (base 11-15) and
     `mintFollowUps` (base 66-71). Nothing else used them.
   - `tests/orchestrator-cli.test.ts`: removed the `doMintFollowUps` import (base 10), the two
     `ORCHESTRATOR_MINT_*` deletes in the top-level `beforeEach` (base 19-20, used only by the
     mint tests), and `describe('orchestrator-cli mint-follow-ups', …)` (base 211-292, 4 tests).
3. `dist/` rebuilt with `npm run build` and committed in the same commit (8 files under
   `dist/cli/orchestrator-cli.*` and `dist/orchestrator/api-client.*`).
4. `.bws-secrets.toml`: removed base lines 9-16, the three-line comment and the
   `221a48d5-3f29-4898-b300-b4820140c880` (`ORCHESTRATOR_M2M_CREDENTIALS`, `SDS Operator`) entry.
   The security scanner's manifest check agrees: it reports no finding for that UUID on the branch.
5. `.cred-consumers.toml`: no change. It doesn't list `drift-audit.sh` as a consumer of the SYSTEM
   bearer. Line 28 says the orchestrator's registry holds "the sds-operator BWS token"; that's
   about where the token's row lives, not about minting, and it stays true. Line 210 lists
   `drift-audit.sh` as a reader of the infra-drift BWS machine token, which it still is.
6. Docs: none needed changing. `git grep -n -i "follow-up mint\|mint-follow-ups\|WS-P2.8"` outside
   `dist/` found, besides the code removed in the preceding steps, only `PROJECT.md:33`, a backlog
   item that names "WS-P2.8 Task 10" as where it was surfaced; that's history and stays true.
   `RUNBOOK.md`, `CLAUDE.md`, `scripts/README.md`, and `docs/` don't describe the mint step.

## Grep outputs

Step 1, after the edit (no output, exit 1):

```
$ grep -n "BWS_ACCESS_TOKEN_SDS\|ORCHESTRATOR_MINT\|mint-follow-ups\|221a48d5" scripts/drift-audit.sh
$ echo $?
1
```

Step 2, before removing the code, `git grep` over the repo outside `dist/` and `node_modules/`
for `mint-follow-ups\|mintFollowUps\|FollowUpMintResponse\|ORCHESTRATOR_MINT\|BWS_ACCESS_TOKEN_SDS\|221a48d5`
matched only `.bws-secrets.toml`, `scripts/drift-audit.sh`, `src/cli/orchestrator-cli.ts`,
`src/orchestrator/api-client.ts`, and `tests/orchestrator-cli.test.ts`: the code being removed and
its own tests. `grep -l "mint-follow-ups\|orchestrator-cli" ~/Library/LaunchAgents/*.plist`
(read-only) printed nothing. After the change the same `git grep` prints nothing.

Step 3, after the build:

```
$ grep -c "mint-follow-ups" dist/cli/orchestrator-cli.js
0
$ git status --short
(clean)
```

## Checks run

| Check                                                | Base `68c4af5`             | Branch                                           |
| ---------------------------------------------------- | -------------------------- | ------------------------------------------------ |
| `npx vitest run` (`npm test`)                        | 60 files, 698 tests passed | 60 files, 694 tests passed                       |
| `npm run build`                                      | —                          | clean; only the 8 expected `dist/` files changed |
| `npx tsc --noEmit`                                   | —                          | clean                                            |
| `npx eslint` on the three changed TS files           | —                          | clean                                            |
| `npx prettier --check` on the three changed TS files | —                          | clean                                            |
| `shellcheck scripts/drift-audit.sh`                  | —                          | exit 0                                           |
| `bash -n scripts/drift-audit.sh`                     | —                          | ok                                               |

The drop of 4 tests is exactly the 4 removed mint tests; the file count is unchanged because
`tests/orchestrator-cli.test.ts` keeps its observe tests.

- Security scan from the repo root: 0 BLOCK, 6 WARN, 1 INFO, 1 allowlisted. The WARNs are four
  `.gitignore` glob-coverage findings and two `reference-by-stable-uuid` findings in a March 2026
  plan; none is in a file this diff touches. No manifest finding for the removed UUID.
- `code-standards risk`: `high-risk`, matched rule `secrets: .bws-secrets.toml`.
- `vendor-review`: complete, 2 of 2 seats succeeded (claude: approve, codex: approve); agy: off
  by configuration. 0 findings kept, 0 dropped, so nothing to reproduce.
- `/code-review` (low) on `origin/main...HEAD`: no findings.

## Files changed

`scripts/drift-audit.sh`, `src/cli/orchestrator-cli.ts`, `src/orchestrator/api-client.ts`,
`tests/orchestrator-cli.test.ts`, `.bws-secrets.toml`, and 8 rebuilt files under `dist/`
(13 files, 6 insertions, 259 deletions), plus this report.

## Self-review

The diff is removal only. The two remaining non-fatal steps keep their `if … then log ok else log
WARN` shape. `OrchestratorClient` keeps `postObservation`, which the observe step uses, and its
shared `req` helper. `makeClient` still reads the drift-reporter credential, untouched.

## Concerns

- The worktree's `node_modules` was empty, so the first build resolved packages from the main
  checkout and rewrote module paths in `dist/bundle/change-mgr-cli.js` (`../../node_modules/…`).
  I discarded that, ran `npm ci` inside the worktree, and rebuilt; the bundle is unchanged in the
  commit. Other workers building in a fresh worktree can hit the same trap.
- Until HQ merges this and the main checkout syncs, the Mac's 03:00 infra-drift run still mints
  alongside the lane, as deploy.md describes. That's the planned order, not a defect.
- The orchestrator's consumer row for the SYSTEM bearer (item 10) still names this script until
  that later orchestrator PR lands.

## Standards followed

- Code Brain rule 3 (structured JSON logs to stdout): the change adds no logging; the script's
  remaining log lines are unchanged.
- Code Brain rule 4 (never swallow an exception silently): the observation and security-drift
  steps keep their logged `WARN` lines. The diff adds no `catch {}` and no `|| true`.
- Code Brain rule 5 (never log secrets): the diff adds no log line. It removes the code that read
  a bearer from the Keychain; no test output prints a token.
- Infra Brain 591, 592, 593 (no BWS token in tracked files or history, no inline
  `BWS_ACCESS_TOKEN` value, placeholder test values): the diff adds no token or value. It removes
  an inline `BWS_ACCESS_TOKEN=` override (a Keychain read, never a literal) and the `'tok'`
  placeholder tests. The scan reports 0 BLOCK.
- Infra Brain 1032 (exposure means rotate): I saw no secret value anywhere in this work; the
  manifest and script hold UUIDs and Keychain account names only.
- Infra Brain 212 (HTTPS for public FQDNs): doesn't apply; the change serves nothing.
- Infra Brain 2890 (never commit a ping URL): the change adds none.
- Infra Brain lesson 450 (rotation landmines): this report and the PR name credentials by id
  only; no secret value appears in a test, plan, report, or log.
