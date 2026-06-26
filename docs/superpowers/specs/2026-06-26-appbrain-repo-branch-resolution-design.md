# App-brain repo + branch resolution for the app-conformance handoff brief

**Date:** 2026-06-26
**Status:** Approved (brainstorm) — pending spec review
**Source prompt:** `~/docs/app-conformance-handoff/infraops-consumer-wiring-prompt.md`
**Depends on (all GREEN):** app-brain prod live; REST `GET /api/apps/resolve` deployed
(`app-brain.devonwatkins.com`, verified `401` on the protected route = route exists); brain
repo PR #4 (`ac4bb84`) merged.

## Problem

PR #26 (`5f6086f`) shipped the app-conformance lane: when the health-check probe-guard holds an
auto-enable because the app returns a 4xx (non-auth), it builds a structured `HandoffPackage` /
human brief telling a build agent which repo+branch to fix. In v1 that package derives **repo and
target branch by parsing the Coolify `resource_name`** (`<owner>/<repo>:<branch>` → `<repo>`, branch
after the `:`).

That parse is **wrong**, not merely retired:

- Coolify uses **rolling deploys** — the `resource_name` suffix is an **ephemeral image-tag hash**
  (`...:main-sgkoo800…`), not the git branch. Container names are equally ephemeral. Any id embedded
  in `resource_name` must never be a lookup key.
- For booking it yields branch `main` (the Coolify app-name prefix), when the real git branch is
  `master`. Leaving this in is a **latent wrong-branch bug**, the exact thing a future auto-dispatch
  must not act on.

The authoritative source is app-brain's structured deployment fields, now reachable over HTTP via
the new REST resolve endpoint. This task makes the handoff brief consume that endpoint, failing safe
to `UNCONFIRMED` whenever the resolver can't give a confident answer.

**Out of scope:** auto-dispatch. This only makes repo+branch authoritative (or `UNCONFIRMED`) in the
brief.

## The join keys (correctness core)

Two stable identifiers, both already available where the handoff is built:

| Key | Role | Source in code |
|-----|------|----------------|
| `coolify_app_uuid` | **PRIMARY** (exact) | `proposal.target.uuid` — the stable Coolify **application** UUID = the drift item's `resource_uuid` (verified: booking prod `hkw488ggssgcskk0ooc0ksk0`, preview `yscogs0wggcgco8g4wwk0o0g`). Stable across rolling redeploys. |
| `fqdn` | **FALLBACK** (host) | host parsed from `url` — the health-probe URL `buildHealthProbeUrl(app.fqdn, path)` already passed into `buildHandoff` (e.g. `https://booking.devonwatkins.com/api/health` → `booking.devonwatkins.com`). `null` when the app has no FQDN. |

The endpoint does uuid-primary / fqdn-fallback **server-side**; the consumer passes both and reads the
result. We never walk the environments array ourselves, and **never** touch the `resource_name` suffix.

## Endpoint contract (verified in `~/Projects/brain`)

```
GET /api/apps/resolve?coolify_app_uuid=<uuid>&fqdn=<host>
  auth:   x-brain-key header (same MCP_ACCESS_KEY value as infra-brain → reuse BWS 45eb083f-…)
  200 →   { github_repo, name, branch, url }   // branch/url may be null — returned as-is, never guessed
  404 →   { error: "not_found" }                // no match
  400 →   neither param given (we always send at least coolify_app_uuid, so not expected)
```

## Components

### 1. `src/services/appbrain-client.ts` (new — mirrors `infrabrain-client.ts`)

- Axios singleton from `APPBRAIN_BASE_URL` + `APPBRAIN_ACCESS_KEY`, `x-brain-key` header,
  `REQUEST_TIMEOUT`.
- `export interface AppResolution { github_repo: string; name: string; branch: string | null; url: string | null }`
- `export function isAppbrainConfigured(): boolean`
- `export async function resolveApp(args: { coolifyAppUuid: string; fqdn: string | null }): Promise<AppResolution | null>`
  - GETs `/api/apps/resolve` with `coolify_app_uuid` always set and `fqdn` set only when non-null.
  - **`200` → returns the body.**
  - **`404` → returns `null`** (no-match; a normal, expected outcome — app not in app-brain yet).
  - **Any other failure (network, timeout, 401, 5xx) → throws** (so the caller can log "resolver
    down" distinctly from a clean no-match). 404 is caught internally via `validateStatus` or a
    try/catch that re-throws non-404 axios errors.

### 2. `src/standards/handoff-brief.ts` (redesign the seam)

**Delete** `resolveRepo`, `parseTargetBranch`, and the old `HandoffDeps.appBrainLookup` boolean seam
(no external callers — verified: referenced only within this file + its tests).

**Add:**

```ts
export interface HandoffDeps {
  appBrainResolve?: (args: { coolifyAppUuid: string; fqdn: string | null })
    => Promise<AppResolution | null>;
}

/** Strip scheme/path/trailing-slash, lowercase → bare host. null when no host. */
export function hostFromUrl(url: string | null | undefined): string | null;
```

`buildHandoff` new resolution flow:

1. `coolifyAppUuid = proposal.target.uuid`; `fqdn = hostFromUrl(url)`.
2. No `appBrainResolve` injected → `repo = "UNCONFIRMED"`, `target_branch = "UNCONFIRMED"`.
   (Stricter than v1, which fell back to the structural parse — intentional; that fallback was the bug.)
3. `appBrainResolve` present → call it inside try/catch:
   - **resolves with non-null `branch`** → `repo = github_repo`, `target_branch = branch` (confirmed).
   - **resolves `null` (404)** → UNCONFIRMED. Log: *no app-brain match for `<uuid>`/`<fqdn>`*.
   - **resolves with `null` branch** → UNCONFIRMED (repo too — never a half-confirmed dispatch target).
     Log: *app-brain matched `<github_repo>` but branch is null*.
   - **throws (resolver error/unreachable)** → UNCONFIRMED. Log at a **distinct, louder level**:
     *app-brain resolver unreachable* — so a persistent outage is a visible signal, not a silent
     stream of UNCONFIRMED briefs.
4. `UNCONFIRMED` repo **and** branch always travel together; we never substitute a parsed/guessed
   value. `buildHandoffPackage` already renders `"UNCONFIRMED — confirm before dispatch"` for repo;
   `target_branch` becomes `"UNCONFIRMED"` in the unconfirmed cases.

Logging: lightweight `console.warn`/`console.error` to stderr (the CLI already writes reports to
stdout; stderr is free for operational signal and shows in the drift-audit logs). No new logging
framework.

### 3. `src/standards/run-remediation.ts` (rename + thread through)

`RemediationDeps.appBrainLookup` → `appBrainResolve?: (args) => Promise<AppResolution | null>`; pass
it into `buildHandoff` as `{ appBrainResolve }` when present.

### 4. `src/cli/remediate-cli.ts` (wire the real client — was never wired in v1)

When `isAppbrainConfigured()`, add `appBrainResolve: (a) => resolveApp(a)` to the `RemediationDeps`
literal; otherwise omit it (→ UNCONFIRMED, fail-safe). Mirrors the lazy/tolerant style of the existing
Anthropic-client wiring.

### 5. `scripts/drift-audit.sh` + `start.sh` (env wiring — mirror INFRABRAIN_*)

```sh
export APPBRAIN_BASE_URL="${APPBRAIN_BASE_URL:-https://app-brain.devonwatkins.com}"
export APPBRAIN_ACCESS_KEY="$(get_secret_by_id "${BWS_APPBRAIN_SECRET_ID:-45eb083f-4b05-4251-924d-b46700e5a643}")"
```

(`start.sh` uses its `fetch_bws_secret` helper.) Same BWS secret UUID as infra-brain — confirmed
app-brain shares the MCP_ACCESS_KEY value. The default base URL is overridable; the secret ID is
overridable via `BWS_APPBRAIN_SECRET_ID`. Update `scripts/README.md` env table.

## Error handling / fail-safe summary

Every non-confirmed path → `UNCONFIRMED` (repo + branch), which renders a human-fillable brief.
**Never** a parsed or guessed value. The four UNCONFIRMED causes (no resolver, 404, null branch,
resolver error) are functionally identical but **logged distinctly**, so resolver-down is operationally
visible.

## Testing (TDD, `npx vitest run`)

`tests/handoff-brief.test.ts` — replace the deleted `resolveRepo`/`parseTargetBranch` cases with:

- **Confirmed (primary uuid):** injected fake resolver returns
  `{github_repo:"AlobarQuest/booking-system", name:"prod", branch:"master", url:…}` for booking prod
  uuid → handoff `repo="AlobarQuest/booking-system"`, `target_branch="master"`.
- **Confirmed (fqdn fallback):** resolver keyed so `preview.booking.devonwatkins.com` → branch
  `preview`; assert `hostFromUrl` extracted the host the resolver received.
- **404 / no-match** → UNCONFIRMED (repo + branch).
- **null branch** → UNCONFIRMED.
- **resolver throws** → UNCONFIRMED (and does not propagate the error).
- **no resolver injected** → UNCONFIRMED.
- `hostFromUrl` unit cases: scheme strip, trailing slash, uppercase → lowercase, path strip, `null`/`""` → null.

`tests/appbrain-client.test.ts` (new) — mocked axios: 200 → body; 404 → `null`; 500/network →
throws; asserts `fqdn` omitted from params when null and `x-brain-key` header set.

No network in any test (injected fake / mocked HTTP), mirroring the existing suite.

## Verify (beyond unit)

- Confirm the real `coolify.enable_healthcheck` app-conformance path now populates repo+branch from
  app-brain (not the resource_name parse) — trace `buildHandoff` end to end.
- One authenticated live probe against `app-brain.devonwatkins.com/api/apps/resolve?coolify_app_uuid=hkw488ggssgcskk0ooc0ksk0`
  with the real key (sourced from BWS at runtime, never pasted) → expect booking prod/master. Validates
  the BWS-secret-shared assumption and the live contract. Read-only.
- Full suite green; `npm run build` + `git add dist/` in the same change (dist/ is tracked and
  CI-enforced to match a fresh build).

## Constraints

infraops conventions: `dist/` committed and must match a fresh build; `main` branch-protected (branch
+ PR); TDD; no secrets in tracked files. Deliver as a PR noting the FQDN/uuid-as-join-key decision
(rolling deploys make resource ids ephemeral) and any app-brain HTTP gap hit.
