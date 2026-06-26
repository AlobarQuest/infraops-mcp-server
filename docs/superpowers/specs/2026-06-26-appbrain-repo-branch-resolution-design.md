# App-brain repo + branch resolution for the app-conformance handoff brief

**Date:** 2026-06-26
**Status:** Approved (brainstorm) + hardened by multi-LLM panel (Opus 4.8 + Codex) — pending final spec review
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
  - GETs `/api/apps/resolve` with `coolify_app_uuid` always set and `fqdn` set only when non-null
    (passed via the axios `params` object so values are URL-encoded — never string-concatenated).
  - **Strict status handling (panel HIGH-2):** `validateStatus: (s) => s === 200 || s === 404`.
    `404 → null` (no-match; normal — app not in app-brain yet). `200 → validateResolution(body)`.
    **Every other status throws** (so a 401/400/5xx body can never slip through as data). A broad
    `validateStatus` (e.g. `s < 500`) is explicitly forbidden — it would resolve a `{error:…}` body
    whose `branch` is `undefined`, and `undefined !== null` would read as "confirmed".
  - **`validateResolution(body)` runtime guard:** `github_repo` and `name` must be non-empty strings;
    `branch` must be a non-empty string OR `null`; `url` must be a string or `null`. A malformed 200
    body fails this guard → treated as a resolver error (throws), never confirmed.
  - **Throws on network/timeout/non-200-non-404** so the caller logs "resolver down" distinctly from a
    clean 404 no-match.
- **`getClient` config hardening (panel MED-4):** require `APPBRAIN_BASE_URL` to be `https:` and reject
  a URL carrying userinfo credentials (`user:pass@`), so the secret-bearing `x-brain-key` can never be
  sent in cleartext or to a credential-spoofed host. The default (`https://app-brain.devonwatkins.com`)
  passes; an accidental `http://`/localhost override fails fast with a clear error.

### 2. `src/standards/handoff-brief.ts` (redesign the seam)

**Delete** `resolveRepo`, `parseTargetBranch`, and the old `HandoffDeps.appBrainLookup` boolean seam
(no external callers — verified: referenced only within this file + its tests).

**Add:**

```ts
export interface HandoffDeps {
  appBrainResolve?: (args: { coolifyAppUuid: string; fqdn: string | null })
    => Promise<AppResolution | null>;
}

/** Parse a bare host from a URL with `new URL()`. http/https only; reject userinfo; return
 *  `hostname.toLowerCase()` (NOT `host` — drops any port); null on any invalid/unsafe input. */
export function hostFromUrl(url: string | null | undefined): string | null;
```

**`hostFromUrl` hardening (panel HIGH-3 — Coolify app fields are not a trust boundary):** parse via
`new URL()`; accept only `http:`/`https:` protocols; reject a URL carrying `username`/`password`;
return `url.hostname.toLowerCase()` (hostname, so a `:port` tail is dropped); return `null` for any
parse failure, control chars, comma-tail, or non-http scheme. A permissive string-strip could send a
misleading fallback key and misjoin to the wrong app when the uuid is absent/stale.

`buildHandoff` new resolution flow:

1. `coolifyAppUuid = proposal.target.uuid`; `fqdn = hostFromUrl(url)`.
2. No `appBrainResolve` injected → both UNCONFIRMED.
   (Stricter than v1, which fell back to the structural parse — intentional; that fallback was the bug.)
3. `appBrainResolve` present → call it inside try/catch. **Confirmed requires BOTH `github_repo` AND
   `branch` to be non-empty trimmed strings** (panel HIGH-1 — a `{github_repo:null, branch:"master"}`
   response must NOT yield repo=UNCONFIRMED + branch=master):
   - **`github_repo` non-empty AND `branch` non-empty** → `repo = github_repo`, `target_branch = branch`.
   - **`null` (404)** → UNCONFIRMED. Log (info): *no app-brain match for `<uuid>`/`<fqdn>`*.
   - **matched but `github_repo` or `branch` empty/null** → UNCONFIRMED. Log (warn): *app-brain matched
     but repo/branch incomplete*.
   - **throws with axios 401/403** → UNCONFIRMED. Log (error, distinct): *app-brain auth rejected —
     check APPBRAIN_ACCESS_KEY* (a misconfiguration, not an outage).
   - **throws otherwise (network/timeout/5xx/malformed body)** → UNCONFIRMED. Log (error, distinct):
     *app-brain resolver unreachable* — so a persistent outage is a visible signal, not a silent
     stream of UNCONFIRMED briefs.
4. `UNCONFIRMED` repo **and** branch always travel together; we never substitute a parsed/guessed value.

**`buildHandoffPackage` normalization (panel MED-5):** make the half-confirmed state unrepresentable at
the builder, not just by convention — if `repo` is null/`"UNCONFIRMED"` OR `targetBranch` is not a
non-empty string, force **both** `repo` and `target_branch` to `"UNCONFIRMED"`. This stops any future
caller/test from producing repo=UNCONFIRMED + branch=main.

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

(`start.sh` uses its `fetch_bws_secret` helper.) The default base URL is overridable; the secret ID is
overridable via its own `BWS_APPBRAIN_SECRET_ID` var. **Decision (Devon, 2026-06-26): keep the shared
key for v1** — `BWS_APPBRAIN_SECRET_ID` *defaults to* infra-brain's `45eb083f-…` because app-brain
currently shares the MCP_ACCESS_KEY value. Using a **separate env var name** (not literally reusing
`BWS_INFRABRAIN_SECRET_ID`) future-proofs the wiring: when app-brain gets a distinct key later, only the
secret value/UUID changes — no code change (this also partially addresses panel MED — blast-radius
coupling — at zero cost now). Update `scripts/README.md` env table.

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
- **null/empty `github_repo` WITH a non-null branch** → UNCONFIRMED for **both** (panel HIGH-1 regression test).
- **resolver throws** → UNCONFIRMED (and does not propagate the error).
- **no resolver injected** → UNCONFIRMED.
- `buildHandoffPackage` normalization: a call with `repo:null, targetBranch:"main"` → both `UNCONFIRMED`
  (panel MED-5 regression test).
- `hostFromUrl` unit cases (panel HIGH-3 matrix): scheme strip, trailing slash, uppercase → lowercase,
  path strip, `null`/`""` → null, **`https://user:pass@booking.devonwatkins.com/x` → null**, **`:port`
  dropped**, **comma-separated tail rejected**, **non-http scheme → null**, **control chars → null**,
  **unparseable → null**.

`tests/appbrain-client.test.ts` (new) — mocked axios: 200 valid body → body; 200 **malformed** body
(empty `github_repo`, or `branch:123`) → throws (validateResolution); 404 → `null`; 401/500/network →
throws; asserts `fqdn` omitted from params when null, `x-brain-key` header set, and that `getClient`
rejects an `http://` or credentialed `APPBRAIN_BASE_URL`.

No network in any test (injected fake / mocked HTTP), mirroring the existing suite.

## Verify (beyond unit)

- Confirm the real `coolify.enable_healthcheck` app-conformance path now populates repo+branch from
  app-brain (not the resource_name parse) — trace `buildHandoff` end to end.
- One authenticated live probe against `app-brain.devonwatkins.com/api/apps/resolve?coolify_app_uuid=hkw488ggssgcskk0ooc0ksk0`
  with the real key (sourced from BWS at runtime, never pasted) → expect booking prod/master. Validates
  the BWS-secret-shared assumption and the live contract. Read-only.
- Full suite green; `npm run build` + `git add dist/` in the same change (dist/ is tracked and
  CI-enforced to match a fresh build).

## Panel review (2026-06-26)

Reviewed adversarially by a cross-vendor panel: **Opus 4.8** (this author) + **Codex/OpenAI** (grounded
review — read the actual repo files). *Gemini was disqualified mid-run — its CLI auth is deprecated
(`IneligibleTierError`).* **Verdict: architecture sound, no blockers** — both models independently
affirmed uuid-primary + server-side join + deleting the `resource_name` parse, and independently
converged on the same top issues. All findings were implementation-contract hardenings, folded in above:

- **HIGH-1** half-confirmed state → confirm requires BOTH github_repo AND branch non-empty.
- **HIGH-2** loose 404-vs-error → strict `validateStatus` (200|404 only) + `validateResolution` body guard.
- **HIGH-3** `hostFromUrl` misjoin → `new URL()`, http/https only, reject userinfo, hostname-lowercased, null-safe.
- **MED-4** base-URL key exfil → `getClient` enforces https + rejects credentialed URL.
- **MED-5** builder permissiveness → `buildHandoffPackage` forces both-UNCONFIRMED if either is unset.
- **MED (shared key)** → Devon decision: keep shared for v1; separate `BWS_APPBRAIN_SECRET_ID` var future-proofs rotation.

**Optional producer follow-up (panel LOW-6, not blocking):** ask app-brain to add `matched_by:
"coolify_app_uuid" | "fqdn"` to the resolve response. It would let the consumer log *how* a match was
made (uuid vs fqdn fallback) and document/guarantee server-side uuid-wins precedence. Out of scope for
this consumer PR; note it in the PR for the app-brain side.

## Constraints

infraops conventions: `dist/` committed and must match a fresh build; `main` branch-protected (branch
+ PR); TDD; no secrets in tracked files. Deliver as a PR noting the FQDN/uuid-as-join-key decision
(rolling deploys make resource ids ephemeral) and any app-brain HTTP gap hit.
