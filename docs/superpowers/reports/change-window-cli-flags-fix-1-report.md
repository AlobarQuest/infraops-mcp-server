Outcome: done

# Build report: change-window CLI flags, fix round 1

PR #171, branch `hq/change-window-cli-flags`. The same text is in
`docs/superpowers/reports/change-window-cli-flags-report.md`.

## Fix round 1

Worker W-226. The per-task review found that `parseArgs` read `--name=value` as the key
`name=value` and kept unknown flags. So `run-window --instance=prod` ran both instances, against
D-67 C, `run-window --dry-run=true` made a real run, and an unknown flag was ignored.

### What changed

- `src/cli/change-mgr-cli.ts` adds `checkRunWindowFlags(argv)`. `main` calls it first in the
  `run-window` branch, before `parseInstance`, `parseDryRun`, and `client()`, so a bad flag
  fails before any network call. It throws on the following arguments:
  - Any `--name=value` argument: `run-window flags take no "=": --instance=...`. The message
    names the flag, not its value.
  - Any flag outside the known set: `unknown run-window flag: --bogus`.
- The known set is the flags `run-window` reads today: `--report-dir` and `--now` (read by
  `main`), and `--instance` and `--dry-run`. `doRunWindow` reads no flag of its own. It reads only
  the `MAX_CHANGES_PER_WINDOW` environment variable.
- `parseArgs` is unchanged, so every argument the Mac wrapper passes is read as before.
  `scripts/change-window.sh` line 84 (`run-window --report-dir "$REPORT_DIR" --now "$NOW"`) is
  unchanged and passes the check.
- `sync` keeps its lenient parsing. Sharing the check would mean a second known-flag set and a
  behavior change for every `sync` caller, which is outside this fix's scope.
- `dist/` was rebuilt and committed, including the bundle. Run with no environment variables,
  `node dist/bundle/change-mgr-cli.js run-window --instance=prod`, `--dry-run=true`, and
  `--bogus` each exit 1 with the messages in the preceding list. The wrapper's exact argument
  list gets past the check and stops at `client()` with this message:
  `CHANGE_MGR_API_BASE and CHANGE_MGR_M2M_TOKEN must be set`.
- The bundle size in the "Bundled single-file build" section now reads 1,724,012 bytes, the
  `wc -c` of the committed file at the new head. The size at `97d088b` was 1,723,527 bytes, not
  the 1,723,455 the report stated.

### Tests added

All are in `tests/change-mgr-cli.test.ts`.

- `main` rejects `run-window --instance=prod`, `run-window --dry-run=true`, and
  `run-window --bogus`. Each case sets both environment variables, spies on `fetch`, and asserts the
  rejection message and that `fetch` was never called. With the `checkRunWindowFlags` call
  commented out, all three fail with `fetch failed`, meaning the run reached the network.
- `checkRunWindowFlags` accepts the wrapper's exact list,
  `run-window --report-dir /r --now 2026-11-18T04:00:00Z`, and `parseArgs` still reads it as
  `{command: "run-window", "report-dir": "/r", now: "2026-11-18T04:00:00Z"}`.

### Checks

- `make check`: exit 0. Vitest reported 60 files and 696 tests passed.
- CI on `a4f32c0`, all successful:
  - Build, run 44412380613 (`pull_request`).
  - Quality, "Lint, type-check, and test", run 44412380519 (`pull_request`). Its log shows 696
    tests passed.
  - Quality, "Lint, type-check, and test", run 44412371401 (`push`).
- New head with the fix: `a4f32c0`, a fast-forward on `97d088b`. The report commits that follow
  it touch only `docs/superpowers/reports/`.
- Quality failed on report commit `d031a7d` (runs 44412905660 and 44412896404): Prettier rejected
  inline code spans that wrapped across lines in both reports. I rewrapped them, and `make check`
  then exited 0 with 696 tests. Build passed on that commit (run 44412906180).

### Files changed

- `src/cli/change-mgr-cli.ts`
- `tests/change-mgr-cli.test.ts`
- `dist/bundle/change-mgr-cli.js`, `dist/cli/change-mgr-cli.js`, `dist/cli/change-mgr-cli.js.map`,
  `dist/cli/change-mgr-cli.d.ts`, and `dist/cli/change-mgr-cli.d.ts.map`
- `docs/superpowers/reports/change-window-cli-flags-report.md` and
  `docs/superpowers/reports/change-window-cli-flags-fix-1-report.md`

### Self-review

- `/code-review` at low effort on `97d088b..a4f32c0` returned no findings.
- Edge cases I checked by reading the code: a bare `--` is rejected as an unknown flag, and a
  value that contains `=` (`--report-dir /a=b`) passes, because the check reads only arguments
  that start with `--`.
- `scripts/change-window.sh` line 84 is the only `run-window` caller in `scripts`, `tests`,
  `docs`, and `src`. No LaunchAgent in `~/Library/LaunchAgents` calls the CLI directly.

### Concerns

- The first build in this worktree ran with an empty `node_modules`. It resolved packages from
  the main checkout's `node_modules`, which is on `main`'s lockfile. That bundle was 1,621,722
  bytes. I ran `npm ci` in the worktree and rebuilt before committing, so the committed bundle
  differs from `97d088b` only by the fix (13 lines). A build agent in a fresh worktree needs
  `npm ci` first, or it can commit a bundle built from the wrong dependencies.
- The handoff said to move the branch with `git reset --hard`. The hook denied it, so I used
  `git merge --ff-only origin/hq/change-window-cli-flags`. The branch started at `c3359bf`, an
  ancestor of `97d088b`, and the tree was clean, so the result is the same.
- A stray positional argument, such as `run-window prod`, is still ignored silently. The handoff
  scoped the fix to `--` flags. This can't widen a run the way `--instance=prod` did, but a
  follow-up could reject it.

### Standards followed

- **Code Brain 3 (structured logs to stdout, not files):** the fix adds no logging and no file
  writes.
- **Code Brain 4 (never swallow an exception; no empty `catch {}`):** `checkRunWindowFlags`
  throws, and `main`'s existing handler prints the message and exits 1. The fix adds no `catch`.
- **Code Brain 5 (never log secrets, tokens, auth headers, or bodies):** the new messages name
  only the bad flag. The `=` form message drops the value. Neither includes the bearer or a
  request body.
- **Infra Brain 591, 592, and 593 (no BWS token in tracked files or history; no inline bootstrap
  token):** the fix reads and names no token. The tests use the placeholder
  `CHANGE_MGR_M2M_TOKEN=t` and the base URL `https://cm.invalid`.
- **Infra Brain 1032 (attested consumer sets):** no credential or consumer changes.
- **Infra Brain 212 (HTTPS for public FQDNs):** not applicable. The fix makes no domain changes.
