Outcome: done

# Build report: change-window CLI flags and bundled build

ADR-0059 increment 8, step 3j, PR 1. Worker W-225.

- **PR:** [AlobarQuest/infraops-mcp-server#171](https://github.com/AlobarQuest/infraops-mcp-server/pull/171),
  branch `hq/change-window-cli-flags`, base `origin/main` at `c3359bf`.
- **Code head:** `da7cb31` (CI green). This report's commit follows it on the same branch.
- **Not merged.** No production action, and no network call to change-manager, Coolify,
  Anthropic, BWS, or Healthchecks.

## What I built

- **One selection function.** `selectItems(items, { maxChangesPerWindow, instance })` in
  `src/change-manager/run-window.ts` drops `security` and `rotation` items. If `instance` is set,
  it keeps only items with `item.instance === instance`, then caps. The instance filter runs before
  the cap. `runWindow` selects through it, and `WindowDeps` extends `SelectOptions`, so the real run
  and the dry run share one code path.
- **`run-window --instance <prod|dev>`.** `parseInstance()` rejects any other value, and it rejects
  a missing value (`--instance` with nothing after it, or followed by another flag). `main` checks
  every flag before it calls `client()`, so a bad flag exits 1 before any network call. Without
  the flag, a run covers both instances as before.
- **`run-window --dry-run`.** `doRunWindow` takes a client, a `makeAgent` factory, and options. A
  dry run makes one `getApproved()` call and applies `selectItems` with the same cap and instance as
  a real run. It writes one stdout line,
  `{"dry_run":true,"instance":"prod"|null,"would_claim":[ids]}`, and returns 0. It never calls
  `startWindow`, `claim`, `postOutcome`, `finishWindow`, or `makeAgent`, so it needs no
  `ANTHROPIC_API_KEY`. It writes no report file, even when `--report-dir` is passed. A bare flag
  is required: `--dry-run <value>` exits 1, so a mistyped command can't run for real. In a real
  run, the Anthropic client is still constructed before `startWindow`, as before.
- **Bundled single-file build.** `scripts/bundle-cli.mjs` uses esbuild's API with these settings:
  - ESM, `platform=node`, `target=node18`, every npm dependency bundled, and Node built-ins
    external. It writes no source maps.
  - A `createRequire` banner, because bundled CommonJS dependencies (`form-data` under axios)
    call `require()` for built-ins, and ESM has no `require`.
  - The output is `dist/bundle/change-mgr-cli.js`, 1,724,012 bytes (`wc -c`) at the fix round 1
    head.

  `npm run build` is `tsc && node scripts/bundle-cli.mjs`. esbuild is pinned exactly at `0.28.1`,
  the version tsx already resolved, so the lockfile diff is one line. A pin at `0.28.2` would have
  moved tsx's copy too. Nothing builds a pinned image here, so a later bake isn't ruled out.

- **`dist/` rebuilt and committed** in the same PR. The CLAUDE.md Quick Reference build line names
  the bundle.

## Checks

### 1. Tests (vitest, mocks only)

`tests/change-manager-run-window.test.ts` adds the following tests:

- **`selectItems`:**
  - It drops security and rotation items and keeps order.
  - It keeps only the named instance, for both `prod` and `dev`.
  - It filters by instance before the cap: with two dev items followed by three prod items, cap 2
    and `prod` select `[3, 4]`.
  - With no instance, it caps across both instances.
- **`runWindow instance`:** with `instance: 'prod'`, it claims only the prod item.

`tests/change-mgr-cli.test.ts` adds the following tests:

- **`parseArgs`:** it reads `--dry-run --instance prod` and `--instance prod --dry-run` alike
  (`it.each`).
- **`parseInstance` and `parseDryRun`:**
  - `parseInstance` accepts `prod`, `dev`, or no flag, and rejects `bogus` and a missing value.
  - `--dry-run` is a bare flag.
- **`doRunWindow` dry run:**
  - It calls `getApproved` once and never calls `startWindow`, `claim`, `postOutcome`,
    `finishWindow`, or `makeAgent`.
  - It leaves the `--report-dir` directory empty.
  - Its stdout is exactly one line, `{"dry_run":true,"instance":"prod","would_claim":[3,4]}`. The
    item `reasoning` text never appears, which shows the output carries ids only.
- **`doRunWindow` dry run with no instance:** it prints `instance: null` and selects across both
  instances.
- **`doRunWindow` real run with `instance: 'prod'`:** it claims `[2]` and `[4]` only and finishes
  the window with `considered: 2`.
- **`main`:** each of the following inputs rejects with the `--instance` error while `fetch` is
  spied and never called (`it.each`). The environment variables were set, so the error can't be
  the missing-environment error.
  - `--instance bogus`
  - `--dry-run --instance bogus`
  - `--dry-run --instance`
  - `--instance --dry-run`

### 2. A run with no new flags behaves as before

All existing tests pass. No existing assertion changed.

- **`tests/change-mgr-cli.test.ts`:** I rewrote the file to add imports and cases. The two
  original `parseArgs` tests are unchanged.
- **`runWindow`:** the existing cap, claim-409, outcome, source-exclusion, and `getApproved`
  failure tests pass unchanged.
- **`tests/change-window.test.sh`:** passes, so the Mac wrapper still launches `run-window` the
  same way.
- **The real-run path in `doRunWindow`:** one behavior-neutral edit. It renders the window
  markdown once and reuses the string for `finishWindow` and stdout. The old code called
  `renderWindowMarkdown(now, summary)` twice with the same arguments.

### 3. Bundle runs from a scratch directory

I copied the bundle alone into `mktemp -d /tmp/cw-bundle.XXXX`, outside the repo and with no
`node_modules`, and ran it there:

| Command                                                                                                                     | Exit | Output                                                   |
| --------------------------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------- |
| `node change-mgr-cli.js run-window --dry-run --instance bogus`, without `ANTHROPIC_API_KEY`                                 | 1    | `--instance needs prod or dev, got: bogus`               |
| `node change-mgr-cli.js`, with no command                                                                                   | 1    | `unknown command: undefined (use sync \| run-window)`    |
| `node change-mgr-cli.js run-window --instance`                                                                              | 1    | `--instance needs a value: prod or dev`                  |
| `run-window --dry-run --instance prod --report-dir <scratch>`, against a local `127.0.0.1` stub with no `ANTHROPIC_API_KEY` | 0    | `{"dry_run":true,"instance":"prod","would_claim":[3,4]}` |
| `run-window --dry-run`, against the same stub                                                                               | 0    | `{"dry_run":true,"instance":null,"would_claim":[1,3,4]}` |

The stub logged only `GET /api/items?status=approved` for each dry run, and the scratch directory
held only the bundle afterward. These runs show that the entry guard fires for the bundle. The
vitest runs show that it doesn't fire on import.

I also checked that the bundle is self-contained, in two ways:

- **Remaining imports:** every static `import` and literal `require()` left in the bundle names a
  Node built-in, with one exception: `debug`'s optional `require("supports-color")`. That call
  sits inside `debug`'s own `try`, and the package isn't installed even in the full
  `node_modules`, so the outcome is the same either way.
- **Path lookups:** the bundle uses no `__dirname` or `__filename`. Its only `import.meta.url` is
  in the banner.

### 4. `make check`, build freshness, and CI

- **`make check`:** exit 0 at the code head. eslint, `tsc --noEmit`, prettier, shellcheck, and the
  shell tests pass, and vitest reports **60 files passed, 692 tests passed**. I added 17 tests, so
  the count at base was 675 by subtraction; I didn't re-run base.
- **Local build:** `npm run build`, then `git status --porcelain dist/`, prints nothing.
- **Build workflow coverage:** the "Verify committed dist/ is up to date" step runs
  `git status --porcelain dist/` after `npm run build`. That command flags a modified bundle and a
  new untracked file under `dist/bundle/`, so the step covers the bundle as written. I didn't edit
  the workflow.
- **CI on Linux:** Build run 44410965167, at head `da7cb31` (Node 24, `npm ci`), passed that step.
  That proves the bundle is byte-identical when built on Linux. Its `npm test` reported
  60 files passed. Both "Lint, type-check, and test" runs passed.

### 5. No new suppression comments

`grep -nE "eslint-disable|@ts-ignore|@ts-expect-error"` over every changed source, test, and
script file found nothing (exit 1).

## Files changed

- `src/change-manager/run-window.ts`: adds `Instance`, `SelectOptions`, and `selectItems`.
  `runWindow` uses it.
- `src/cli/change-mgr-cli.ts`: adds `parseInstance`, `parseDryRun`, and the dry-run branch.
  `doRunWindow(client, makeAgent, opts)` and `main(argv)` are exported.
- `tests/change-manager-run-window.test.ts` and `tests/change-mgr-cli.test.ts`: new tests.
- `scripts/bundle-cli.mjs`: new esbuild build script.
- `package.json` and `package-lock.json`: the `build` script, and `esbuild` pinned at `0.28.1` as
  a devDependency.
- `dist/change-manager/run-window.*`, `dist/cli/change-mgr-cli.*`, and
  `dist/bundle/change-mgr-cli.js` (new): rebuilt output.
- `CLAUDE.md`: the Quick Reference build line.
- This report.

I left `scripts/change-window.sh`, the plist, `.cred-consumers.toml`, `.bws-secrets.toml`, and
`.github/workflows/build.yml` unchanged.

## Self-review

I ran `/code-review` (medium) on `origin/main...HEAD`. It raised five findings. None of them
called for a code change in this PR, and the following section records each one.

## Concerns and follow-ups

1. **Report file name has no instance in it.** A real run with `--report-dir` writes
   `<date>.change-window.md`. If someone runs `--instance prod` and `--instance dev` into the same
   directory on the same day, the second run overwrites the first run's local report. The Mac job
   passes no `--instance`, and the lane plan runs prod only, so this doesn't happen in either plan.
   If split runs ever share a directory, add the instance to the file name.
2. **The entry guard matches on file name.** The bundle runs only when it's named
   `change-mgr-cli.js`. Under any other name, or through a symlink with another name, it exits 0
   and does nothing. The handoff asked to keep this guard. The lane's command needs to use this
   exact path, and its heartbeat needs to depend on real output, not on exit 0 alone.
3. **`MAX_CHANGES_PER_WINDOW=0` becomes 5.** This comes from the `|| 5` parse, which predates this
   PR, and the dry run reports the same cap. It's not a pause switch.
4. **`would_claim` is the selection.** It doesn't predict which claims succeed: a claim that returns
   409 in a real run is skipped, and the next item doesn't take its slot. This matches the paired
   pass design (option A).
5. **Bundled-dependency bumps.** The committed bundle inlines the Anthropic SDK, axios, the MCP
   SDK, and their dependencies. A Dependabot PR that bumps any of them, or esbuild, fails the
   `dist/` freshness check until someone runs `npm run build` and commits the result. This is the
   same rule as the rest of `dist/`, with more dependencies in scope. A follow-up could have
   Dependabot PRs rebuild `dist/`, or move to the pinned bake from D-66.
6. **Standards coverage.** The handoff's Standards section covered everything this change touches.

## Standards followed

- **Code Brain 3 (structured logs to stdout, not files):** the dry run writes one JSON line to
  stdout and creates no file. A test checks that the `--report-dir` directory stays empty. No file
  logging was added.
- **Code Brain 4 (never swallow an exception; no empty `catch {}`):** this PR adds no `catch`. A
  bad `--instance` or `--dry-run` value throws, and `main`'s existing handler prints the message
  and exits 1. The bare `catch` around `claim` in `runWindow` predates this PR, and I left it
  unchanged.
- **Code Brain 5 (never log secrets, tokens, auth headers, or bodies):** the dry run prints item
  ids only. A test asserts the exact stdout line, so item content such as `reasoning` can't appear
  in it. The new error messages contain only the bad flag value. None includes the bearer or a
  request body.
- **Infra Brain 591, 592, and 593 (no BWS token in tracked files or history; no inline bootstrap
  token):** nothing in this PR reads or names a token. The tests use the placeholder
  `CHANGE_MGR_M2M_TOKEN=t` and the base URL `https://cm.invalid` with `fetch` spied.
- **Infra Brain 1032 (`cred.exposure-rotate`, attested consumer sets):** no credential or consumer
  changes. `.cred-consumers.toml` and `.bws-secrets.toml` are unchanged.
- **Infra Brain 212 (HTTPS for public FQDNs):** not applicable. This PR makes no domain changes.

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
  list gets past the check and stops at `client()` with `CHANGE_MGR_API_BASE and
  CHANGE_MGR_M2M_TOKEN must be set`.
- The bundle size in the "Bundled single-file build" section now reads 1,724,012 bytes, the
  `wc -c` of the committed file at the new head. The size at `97d088b` was 1,723,527 bytes, not
  the 1,723,455 the report stated.

### Tests added

All are in `tests/change-mgr-cli.test.ts`.

- `main` rejects `run-window --instance=prod`, `run-window --dry-run=true`, and `run-window
  --bogus`. Each case sets both environment variables, spies on `fetch`, and asserts the
  rejection message and that `fetch` was never called. With the `checkRunWindowFlags` call
  commented out, all three fail with `fetch failed`, meaning the run reached the network.
- `checkRunWindowFlags` accepts the wrapper's exact list, `run-window --report-dir /r --now
  2026-11-18T04:00:00Z`, and `parseArgs` still reads it as `{command: "run-window",
  "report-dir": "/r", now: "2026-11-18T04:00:00Z"}`.

### Checks

- `make check`: exit 0. Vitest reported 60 files and 696 tests passed.
- CI on `a4f32c0`, all successful:
  - Build, run 44412380613 (`pull_request`).
  - Quality, "Lint, type-check, and test", run 44412380519 (`pull_request`). Its log shows 696
    tests passed.
  - Quality, "Lint, type-check, and test", run 44412371401 (`push`).
- New head with the fix: `a4f32c0`, a fast-forward on `97d088b`. The commit that adds this
  section follows it and touches only `docs/superpowers/reports/`.

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
