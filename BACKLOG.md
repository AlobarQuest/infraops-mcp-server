# InfraOps MCP Server — Backlog

Deferred work that has been investigated but not implemented. Each entry
should include the problem, the threat/impact model, a menu of options with
tradeoffs, and (where possible) a preferred path so a future session can
resume without re-discovering context.

---

## 1. Harden `sshWriteFile` / `vpsWriteFile` heredoc delimiter

**Filed:** 2026-04-12
**Severity:** Low probability, high blast radius (RCE on prod VPS as root)
**Component:** `src/services/ssh-client.ts` (`sshWriteFile`), `src/services/vps-dispatch.ts` (`vpsWriteFile` dev path)

### Problem

Both write paths transport file content to the target VPS by inlining it
into a single-quoted heredoc:

```ts
`cat > ${escapeShell(path)} << 'INFRAOPS_EOF'\n${content}\nINFRAOPS_EOF`
```

The single-quoted delimiter (`'INFRAOPS_EOF'`) disables shell expansion, so
`$VAR`, `$(cmd)`, backticks, quotes, and backslashes all pass through safely.
The code is correct for every case except one: if `content` contains a line
that is literally `INFRAOPS_EOF`, the heredoc terminates early and every
byte after that line is reinterpreted as shell commands — running as root on
prod Hetzner or as `devon` (with sudo docker access) on dev OrbStack.

### Threat Model

The attacker needs to convince the MCP caller (an LLM like Claude) to write
a file whose content contains the literal string `INFRAOPS_EOF` on its own
line. Specific vectors:

- A user paste that happens to contain the string
- A documentation file that quotes the write protocol (e.g., this backlog
  entry — if you ever `vps_write_file` this very file, you will trip it)
- A config/template file harvested from a third-party source
- A deliberately crafted prompt-injection payload in any content the LLM
  decides to transfer to the VPS

The probability is low but the blast radius is "arbitrary shell execution
as root." This is a classic delimiter-collision vulnerability — the same
class of bug that breaks naive SQL quoting.

### Constraints

- Must stay binary-safe or at least UTF-8-safe for config files, scripts,
  docker-compose.yml, Dockerfiles, and similar textual content.
- Dev path already goes through `orb run -m <machine> bash -c <cmd>`, so
  any fix must work in that pipeline too, not just raw SSH.
- Should not require additional VPS-side dependencies beyond what is
  already assumed (bash, coreutils). Base64 is universally present.
- Existing callers of `sshWriteFile` / `vpsWriteFile` must continue to
  work without modification.

### Options

#### A. Reject writes containing the literal delimiter (cheapest)

```ts
if (/^INFRAOPS_EOF\s*$/m.test(content)) {
  throw new Error(
    "vps_write_file: content contains the reserved heredoc delimiter 'INFRAOPS_EOF' on a line by itself. Refusing to write."
  );
}
```

- **Pros:** one line, zero runtime overhead, fails loudly at the boundary.
- **Cons:** surprising to callers who happen to trip it ("why can't I write
  this file?"), doesn't solve the class of bug — just this specific
  manifestation. Still requires care if the delimiter is ever renamed.

#### B. Randomize the delimiter per call

```ts
const delim = `INFRAOPS_EOF_${crypto.randomUUID().replace(/-/g, "")}`;
```

- **Pros:** trivially cheap, makes collision astronomically unlikely, no
  caller-visible surprise.
- **Cons:** still technically collision-able; leaks a UUID into the
  command line (not a meaningful information disclosure); non-deterministic
  commands are slightly harder to debug from logs. Does not solve
  binary safety.

#### C. Base64-encode content, decode on the VPS (preferred)

```ts
const b64 = Buffer.from(content, "utf8").toString("base64");
await sshExec(
  `echo ${b64} | base64 -d > ${escapeShell(path)}`
);
```

- **Pros:** bulletproof against delimiter collisions by construction —
  the base64 alphabet never contains newlines, quotes, or shell metacharacters.
  Works identically through `sshExec` and `orbExec`. Adds binary safety
  as a bonus. Base64 is universally available on Linux.
- **Cons:** ~33% wire-size overhead; the full encoded payload sits on a
  single command line, so writes larger than ~1MB may hit shell ARG_MAX
  limits on some systems (`getconf ARG_MAX` on modern Linux is typically
  2MB+, but worth being aware of).
- **Mitigation for large files:** chunk the base64 payload across multiple
  `echo >> file` calls, or fall back to option D.

#### D. Switch to the ssh2 SFTP subsystem

```ts
conn.sftp((err, sftp) => {
  sftp.writeFile(path, content, (err) => { ... });
});
```

- **Pros:** the right tool for the job — a real file-transfer protocol
  designed for exactly this use case. Bulletproof. Binary-safe. Handles
  arbitrarily large content via the SFTP streaming API.
- **Cons:** biggest refactor. Only works on the prod (SSH) path — the dev
  path via `orb run` has no SFTP equivalent, so we would still need
  option C (base64) for dev, producing an asymmetric backend. Also adds
  another code path to maintain and test.

### Recommendation

**Option C (base64) for both backends**, with a content-size guard that
rejects writes larger than ~512KB and points the caller at a future
streaming path if one is ever needed. Base64 keeps the two backends
symmetrical (same strategy for SSH and for `orb run`), eliminates the
delimiter collision entirely rather than just making it unlikely, and
delivers binary safety for free.

If base64's command-line-length limitation ever becomes a real problem,
upgrade the prod path to SFTP (option D) while keeping dev on base64 —
asymmetric but targeted.

### Non-goals

- Reworking the read path (`sshReadFile` / `vpsReadFile`). It uses
  `cat $path` which has no delimiter to collide with; only the content
  payload is at risk, and the read path doesn't inline content into a
  command at all.
- Reworking heredoc usage elsewhere. A project-wide audit showed the
  heredoc pattern is only used in `sshWriteFile`.

### Acceptance criteria (when this gets picked up)

- [ ] `vps_write_file` with content containing `INFRAOPS_EOF` on its own
      line writes correctly and round-trips byte-for-byte.
- [ ] `vps_write_file` with content containing null bytes or high-bit
      UTF-8 round-trips correctly.
- [ ] Both prod (SSH) and dev (orb) paths use the same strategy so there
      is no correctness divergence between backends.
- [ ] Size guard trips with a clear error above some sane limit
      (suggest 512KB initial) rather than producing an obscure
      "Argument list too long" shell error.
- [ ] `tests/vps-dispatch.test.ts` gains coverage for the delimiter
      collision case via mocked backends.

---

## 2. Fix compose env var tools

**Filed:** 2026-04-12 (originally identified 2026-03-27 in `INFRAOPS_IMPROVEMENTS.md` Tier 1 Tool 3)
**Severity:** High — forces manual UI/DB workarounds for every compose app env var change, breaking the "infraops is the only way to change Coolify" rule in `CLAUDE.md`
**Component:** `src/tools/env-vars.ts` — tools `coolify_create_app_env`, `coolify_bulk_create_app_envs`, `coolify_update_app_env`

### Problem

Both `coolify_create_app_env` and `coolify_bulk_create_app_envs` return the
generic error `"Validation failed"` when targeting Docker Compose build pack
apps. The underlying Coolify API endpoints (`POST`/`PATCH`
`/applications/{uuid}/envs`) reject compose apps at the validation layer —
confirmed reproducible across Coolify v4.0.0-beta.463 (prod) and
v4.0.0-beta.470 (dev) as of 2026-04-12.

Every other env var tool works correctly for non-compose apps. This is a
compose-specific failure at the API layer, not a tool-level bug.

### Current workaround

Manual Eloquent updates via `php artisan tinker` inside the Coolify
container (handles Laravel's app-layer encryption transparently). Raw SQL
inserts into the `environment_variables` table fail because the `value`
column is encrypted at the application layer, not the database layer.

### Options

#### A. Wait for Coolify to fix it upstream
- **Pros:** zero work on our side, clean solution.
- **Cons:** unknown timeline; the bug has been reproducible for at least
  3 weeks and no upstream issue filed yet. Blocks real work in the
  meantime. File an upstream issue first either way.

#### B. Discover a compose-specific API endpoint
- **Pros:** if one exists, it's the right answer — use Coolify's intended
  interface.
- **Cons:** the API docs don't mention one; a code spelunk through
  `routes/api.php` in the Coolify repo may reveal an undocumented route.
  Worth ~30 minutes of investigation before committing to option C.

#### C. Implement via `vps_exec` + `php artisan tinker` Eloquent (preferred fallback)
- **Pros:** known-good pattern — it's exactly what we do manually today.
  Handles encryption correctly. Zero dependency on Coolify API changes.
- **Cons:** tightly couples the tool to Coolify's internal data model
  (`EnvironmentVariable` Eloquent class, `environment_variables` table
  schema). Needs re-verification on every Coolify upgrade. Runs shell
  inside the Coolify container, which means `vps_exec` into the right
  instance + `docker exec` into the Coolify container + `php artisan tinker`
  with a heredoc or inline expression. Feels fragile but actually works.
- **Implementation sketch:**
  ```ts
  // Per-instance: vps_exec({instance}, "sudo docker exec coolify php artisan tinker --execute=\"...\"")
  // The tinker expression uses App\Models\EnvironmentVariable::create([...])
  // which runs the encryption cast automatically.
  ```

#### D. Hybrid: probe for the compose endpoint at runtime, fall back to tinker
- **Pros:** upgrade-friendly — if Coolify ever fixes the validation at the
  API, the tool transparently starts using the canonical path.
- **Cons:** more code to maintain, more test surface.

### Recommendation

**Do B first (spelunk for an endpoint, ~30 min), then C if B turns up
nothing.** File the Coolify upstream issue (option A background work)
regardless of which implementation path wins, so the workaround can be
removed later.

### Non-goals

- Changing behavior for non-compose apps (they work fine today).
- Adding a new `coolify_set_compose_env_*` tool family — the existing
  `coolify_create_app_env` / `coolify_bulk_create_app_envs` should
  transparently handle both app types.

### Acceptance criteria

- [ ] `coolify_create_app_env({uuid: <compose-app>, key: "FOO", value: "bar", instance})`
      succeeds on both prod and dev Coolify instances.
- [ ] `coolify_bulk_create_app_envs` accepts an array of vars for a
      compose app in one call.
- [ ] `coolify_list_app_envs` returns the newly-created vars correctly
      (round-trip verifies the encryption cast was applied).
- [ ] Works for `is_build_time`, `is_preview`, and the standard string
      value path — not just basic string creation.
- [ ] Documented in `CLAUDE.md` "Coolify / Infrastructure" section with
      any known limitations of the implementation path chosen.

### References

- `INFRAOPS_IMPROVEMENTS.md` item #2 (original 2026-03-27 filing)
- `infra-brain` lessons #113, #118
- Auto-memory `infraops_brain_knowledge.md` lesson #2

---

## 3. Back up the agent-sites / crm / facelesstt databases (real gap)

**Filed:** 2026-06-14
**Severity:** High — three running Postgres databases have NO backup coverage (data-loss risk); agent-sites is live at agentsweb.site.
**Component:** `~/Projects/vps-backup/backup.sh` (the `pg_dump_container` target list). *The change lands in the **vps-backup** repo, not this one.*

### Problem

The daily drift audit (rule #572) flags `agent-sites-postgres`
(uuid `htiobnojh32lbygljua91mo3`), `crm-db` (`vh6rmgm6wrn8c1owl7tjcbkn`), and
`facelesstt-db` (`s2prstn489509v7po7icp7z9`) as lacking backups. Investigation
(2026-06-14) confirmed these are **genuinely unbacked** — not false positives:
`vps-backup/backup.sh`'s `pg_dump` list covers only contacthub, lifeops,
inbox_assistant, infrabrain, realestate, coolify_db, authentik. These three are
not in it, have no per-app backup script, and no Coolify-native backup config.
(S3 / Coolify-native backups are a red herring — these should go to Restic/NAS
like the other seven.)

### Options

- **A. Add the three to vps-backup's `pg_dump` list (preferred).** One
  `pg_dump_container "<label>" "$(find_container <project-uuid> <service> || true)" "<db>" "<user>"`
  line each, matching the existing seven. Backups flow to Restic on the NAS;
  Healthchecks/freshness coverage extends automatically.
- **B. Per-app backup scripts** (like Contacts/REDealEngine) — heavier; only if a
  DB needs app-specific dump logic.

### Acceptance criteria

- [ ] `agent-sites-postgres`, `crm-db`, `facelesstt-db` each have a
      `pg_dump_container` entry in `backup.sh` with the correct Coolify project
      UUID, container service name, db, and user.
- [ ] A vps-backup run produces fresh dumps for all three; `verify-backup.sh` passes.
- [ ] Container service name + credentials confirmed before adding (inspect via
      `coolify_get_database` / `docker exec`). Note `facelesstt` may live on the
      dev Coolify instance — confirm prod vs dev.

### Dependency

Coupled to item #4: once these are backed up **and** #572 checks real coverage,
the escalations resolve cleanly. Until then they appear as change-manager
escalations with no executor path (handle via defer/wontfix in the GUI).

---

## 4. Re-point rule #572 at real backup coverage (standards fix)

**Filed:** 2026-06-14
**Severity:** Medium — the standard checks the wrong thing: it generates misleading escalations and cannot verify the coverage that actually matters.
**Component:** infra-brain rule #572 + the standards audit (`src/standards/*`).

### Problem

Rule #572 asserts `backup_configs non_empty` on the Coolify database resource —
i.e. it checks Coolify's **native** backup feature, which Devon doesn't use. Real
backups run via **vps-backup** (Restic/NAS) + per-app `pg_dump`. So #572 both
(a) keeps flagging DBs that *are* backed up externally, and (b) can't actually
verify real coverage or freshness. It should check: *is this DB in the vps-backup
coverage set, and is its last backup fresh?*

### Design challenge

The audit's check-engine evaluates **declarative field assertions against live
Coolify state**. Backup coverage is not in Coolify, so #572 can't be a simple
field assertion on the Coolify object — it needs an external source of truth plus
an enrichment step.

### Options

- **A. Coverage manifest + audit enrichment (preferred).** vps-backup emits a
  manifest (per backed-up DB: identity + last-success timestamp). The audit
  enriches each Coolify database resource with synthetic `backup_covered` /
  `backup_fresh` fields from the manifest (mapped by project UUID — vps-backup
  already keys on it). Rule #572's `check.assert` becomes
  `{field: "backup_covered", op: "eq", value: true}` (optionally also `backup_fresh`).
  Single source of truth; verifies freshness, not just existence.
- **B. Static allowlist in infra-brain** — a list of covered DB identities. Simple
  but manual; no freshness; drifts as DBs are added.
- **C. Custom (non-declarative) check function for #572** — escapes the declarative
  model; flexible but breaks the uniform check-engine.

### Recommendation

**A.** Spans three places: vps-backup (emit the manifest), infraops audit (load
the manifest + enrich DB resources), infra-brain (update rule #572's `check`).
Open decisions when picked up: manifest location/transport (a file on the mini the
audit reads, vs pushed to infra-brain), and the DB↔manifest mapping key (Coolify
project UUID is the natural choice).

### Acceptance criteria

- [ ] vps-backup emits a coverage manifest (covered DB identities + last-success timestamps).
- [ ] The audit enriches Coolify database resources with `backup_covered` /
      `backup_fresh` from the manifest.
- [ ] Rule #572 updated in infra-brain to assert on real coverage; re-audit shows
      the covered DBs pass and any genuinely-uncovered DB flags.
- [ ] After item #3 lands, agent-sites / crm / facelesstt pass #572.

### Dependency

Item #3 is the data-side fix (close the gap); this is the check-side fix. Do #3
first, then #4 so the check verifies real state.

---

## 5. Change-window post-verify confirms domain *config*, not async deploy/cert health

**Filed:** 2026-06-14
**Severity:** Low–medium — a failed redeploy on an HTTPS auto-fix can be reported `done` with a stale/missing cert.
**Component:** `src/change-manager/agent.ts` (`postVerifyOrRevert`), `src/change-manager/tools.ts` (`httpsConformant`).

### Problem

The change-window executor's deterministic post-verify (added in Plan 3) re-fetches
the application and reverts if the change "didn't take." For the HTTPS path,
"didn't take" is `!httpsConformant(app)` — i.e. the **domain config string** is not
all-https. But `set_application_domains` sets that field synchronously via PATCH, so
it is already https regardless of whether the subsequent `redeploy_application`
(`POST /applications/{uuid}/deploy`, which regenerates the Traefik route + Let's
Encrypt cert) actually succeeded. If the deploy fails, the agent receives an
`is_error` tool result and is *instructed* to `report_blocked`, but nothing
**deterministically** prevents a `done` with a broken cert.

This matches the drift standard's own conformance definition (rule #571 asserts
`fqdn not_starts_with http://` — a config check, not a cert probe), so the next-day
audit won't catch it either: both verify config, not live cert health.

### Options

- **A. Post-verify confirms a deploy was triggered + probe the live cert (preferred).**
  After the agent reports done on an HTTPS item, poll the deployment
  (`GET /deployments/applications/{uuid}`) for a recent success, and/or make an HTTPS
  request to the domain and check the TLS handshake / cert validity. Deploys are
  async, so this needs a bounded poll/timeout. Revert (or mark `failed`) if the
  deploy errored or the cert isn't valid.
- **B. Cheap deterministic guard.** In post-verify, when `rollback.domains` was
  captured, require that a `redeploy_application` call exists in `tool_calls` and did
  not error; otherwise → `failed` + revert. Catches the "domain set but deploy
  errored / never run" half-applied state without async polling. Doesn't verify the
  cert actually regenerated (deploy "triggered" ≠ "succeeded").
- **C. Re-point rule #571 at real cert health** (parallels item #4 for #572) so both
  the audit and the executor verify live TLS, not just config. Broadest fix.

### Acceptance criteria

- [ ] A failed/never-run redeploy on an approved HTTPS item results in `failed`
      (with revert), not `done`.
- [ ] (If A/C) the live cert is actually validated, not just the domain config field.

### Notes

Surfaced by the Plan 3 final review (2026-06-14). Not a blocker for the initial
ship — observe behavior on the first live window run (operational follow-up with
Devon) before deciding A vs B vs C. The agent's `is_error` feedback + system-prompt
instruction to `report_blocked` is the current (model-judgment) mitigation.
