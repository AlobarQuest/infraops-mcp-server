# InfraOps MCP Server — Required Improvements

Date: 2026-03-27

---

**Status (as of 2026-04-12): mostly shipped.**

- ✅ Tier 1 Tool 1 (`coolify_create_application_deploykey`) — landed in commit `ea14d47` (v3.2.0, 2026-03-27)
- ⏳ Tier 1 Tool 2 (`coolify_set_compose_config`) — also landed in `ea14d47`
- ❌ Tier 1 Tool 3 (fix compose env vars) — **still open**, now tracked in `BACKLOG.md` item #2
- ✅ Tier 2 Tools 4–7 (GitHub provider: `github_create_repo`, `github_add_deploy_key`, `github_list_deploy_keys`, `github_remove_deploy_key`) — all landed in `ea14d47`
- ✅ Tier 3 Tool 8 (extend `coolify_update_application` with compose-specific fields) — landed in `ea14d47`
- ✅ Tier 3 Tool 9 (`coolify_reset_labels`) — landed in `ea14d47`

8 of 9 items are in `main`. Only "fix compose env vars" remains as real work. This file is retained as historical context for the design decisions behind v3.2.0.

---

## Context

During the app-brain migration (Supabase → self-hosted Coolify), multiple infraops gaps forced manual workarounds via direct Coolify DB access, `php artisan tinker`, and `gh` CLI. These same gaps were previously documented in infra-brain lessons #111, #112, #113, #118 during the open-brain and real-estate-engine deployments. This document consolidates all known gaps into an actionable improvement plan.

## Known Gaps

### 1. No private repo app creation (deploy key or GitHub App)

**Infra-brain lessons:** #111, #112, #118

**Current state:** infraops has 3 app creation tools:
- `coolify_create_application_public` — public git repo (HTTPS, no auth)
- `coolify_create_application_dockerfile` — inline Dockerfile
- `coolify_create_application_dockerimage` — pre-built image from registry

None support private GitHub repos. All of Devon's apps are in private repos.

**Workaround used:** Generated SSH keypair via `php artisan tinker` (phpseclib) inside the Coolify container, added public key to GitHub via `gh api`, linked to app via direct DB update. Took ~30 minutes of trial and error (PKCS8 vs OpenSSH format issues, encryption requirements).

**What's needed:** A tool that:
1. Creates a deploy key in Coolify (properly encrypted, OpenSSH format)
2. Returns the public key so it can be added to GitHub
3. Creates the application linked to that key
4. Sets `source_type = 'App\Models\GithubApp'` and correct `private_key_id`

### 2. Env vars fail for Docker Compose apps

**Infra-brain lessons:** #113, #118

**Current state:** Both `coolify_create_app_env` and `coolify_bulk_create_app_envs` return "Validation failed" when targeting Docker Compose build pack apps. The Coolify API endpoints (POST/PATCH `/applications/{uuid}/envs`) reject compose apps.

**Workaround used:** Created env vars via `php artisan tinker` using Eloquent models, which handles encryption automatically. Raw DB inserts fail because the `value` column is encrypted at the application layer.

**What's needed:** Either:
- Investigate if Coolify v4 has a separate API endpoint for compose env vars
- Or add a `coolify_set_compose_env_via_tinker` tool that uses `vps_exec` + `php artisan tinker` as a reliable fallback
- The tool must handle Coolify's Laravel encryption transparently

### 3. Cannot set `docker_compose_domains` via API

**Infra-brain lesson:** #86 (partial — documents the symptom but not the API gap)

**Current state:** `coolify_update_application` does not expose `docker_compose_domains`. This JSON field controls which compose service gets which domain (e.g., `{"api":{"domain":"https://app-brain.devonwatkins.com"}}`). Without it, compose apps get no Traefik routing.

**Workaround used:** Direct SQL update on the Coolify DB: `UPDATE applications SET docker_compose_domains = '...' WHERE uuid = '...'`

**What's needed:** A tool (or extension to `coolify_update_application`) that accepts a service-to-domain mapping and writes `docker_compose_domains` JSON.

### 4. Cannot set `docker_compose_location` via API

**Infra-brain lesson:** #110

**Current state:** Coolify defaults `docker_compose_location` to `/docker-compose.yaml`. If the repo uses `.yml` (which is common), Coolify never parses the compose file — `docker_compose_raw` stays null, no services appear.

**Workaround used:** Direct SQL update on the Coolify DB.

**What's needed:** Expose `docker_compose_location` in `coolify_update_application`, or include it in the compose config tool from item #3.

### 5. Stale `custom_labels` block Traefik routing after domain changes

**Not previously documented in infra-brain.**

**Current state:** When an app is created, Coolify generates `custom_labels` with the initial domain (sslip.io). If the domain is later changed via `docker_compose_domains`, the `custom_labels` still contain the old Traefik rules. Since `custom_labels` takes precedence over auto-generated labels, HTTPS routing breaks — TLS handshake completes but requests timeout because Traefik routes to the wrong backend.

**Workaround used:** Cleared `custom_labels` via DB (`UPDATE applications SET custom_labels = '' WHERE uuid = '...'`), then redeployed. Coolify auto-generated correct labels from `docker_compose_domains`.

**What's needed:** A `coolify_reset_labels` tool that clears `custom_labels` and triggers a redeploy. Or: the domain update tool should automatically clear stale labels.

### 6. No GitHub tools in infraops

**Not previously documented in infra-brain.**

**Current state:** infraops has no GitHub integration. During deployments, repo creation, deploy key management, and Actions checks all required the `gh` CLI.

**What's needed:**
- `github_create_repo` — create public or private repo under a given org/user
- `github_add_deploy_key` — add an SSH public key to a repo (read-only)
- `github_list_deploy_keys` — list existing deploy keys for a repo
- `github_remove_deploy_key` — remove a deploy key by ID

These would complete the deploy key workflow: infraops creates the key in Coolify (#1), gets the public key, then adds it to GitHub (#6), all without leaving the MCP context.

### 7. `coolify_update_application` missing compose-specific fields

**Infra-brain lesson:** #114 (health_check_start_period)

**Current state:** The update tool only exposes: name, description, domains, git_branch, git_repository, build_pack, health_check_enabled/path/port, ports_exposes, docker_registry_image_name/tag.

**Missing fields that were needed:**
- `docker_compose_domains` (JSON)
- `docker_compose_location` (string)
- `custom_labels` (text, or ability to clear)
- `health_check_start_period` (int seconds)
- `private_key_id` (int — link to deploy key)

## Proposed Implementation — Priority Order

### Tier 1: Unblock fully automated deployments

These three tools would have eliminated all manual DB/tinker workarounds during the app-brain migration.

**Tool 1: `coolify_create_application_deploykey`**
- Generates an SSH keypair inside Coolify via `php artisan tinker` (phpseclib Ed25519)
- Stores the private key encrypted in Coolify's `private_keys` table
- Creates the application with `source_type = 'App\Models\GithubApp'`, `private_key_id` linked
- Sets `build_pack = 'dockercompose'` and `git_repository`
- Returns: `{ app_uuid, deploy_key_id, public_key }` — the public key is needed for GitHub
- Parameters: `project_uuid, server_uuid, destination_uuid, git_repository, git_branch, build_pack, name, description, public_key_name`

**Tool 2: `coolify_set_compose_config`**
- Sets `docker_compose_domains`, `docker_compose_location`, and optionally clears `custom_labels`
- Single tool that handles the three most common compose setup fields
- Parameters: `uuid, domains (dict of service→domain), compose_location (string, default /docker-compose.yml), reset_labels (bool, default true)`

**Tool 3: Fix compose env vars**
- Investigate Coolify v4 API for compose-specific env var endpoints
- If none exist, implement via `vps_exec` + `php artisan tinker` Eloquent approach
- Must handle Laravel encryption automatically
- Same interface as existing `coolify_create_app_env` / `coolify_bulk_create_app_envs`

### Tier 2: GitHub integration

**Tool 4: `github_create_repo`**
- Parameters: `name, org (optional), private (bool), description`
- Uses GitHub API via personal access token or GitHub App

**Tool 5: `github_add_deploy_key`**
- Parameters: `repo (owner/name), title, public_key, read_only (bool, default true)`
- Returns: `{ key_id }`

**Tool 6: `github_list_deploy_keys`**
- Parameters: `repo (owner/name)`

**Tool 7: `github_remove_deploy_key`**
- Parameters: `repo (owner/name), key_id`

### Tier 3: Expand update surface

**Tool 8: Extend `coolify_update_application`**
- Add optional parameters: `docker_compose_domains, docker_compose_location, custom_labels, health_check_start_period, private_key_id`
- For `custom_labels`, accept either a string or `null` (to clear/reset)

**Tool 9: `coolify_reset_labels`**
- Clears `custom_labels` to empty string, forcing Coolify to auto-generate from current domain config
- Optionally triggers a redeploy after clearing
- Parameters: `uuid, redeploy (bool, default true)`

## End-to-End Workflow After Implementation

With all tools in place, deploying a new private repo compose app would look like:

```
1. github_create_repo(name="my-app", private=true)
2. git push (code)
3. coolify_create_project(name="My App")
4. coolify_create_application_deploykey(
     project_uuid, server_uuid, destination_uuid,
     git_repository="AlobarQuest/my-app",
     build_pack="dockercompose", name="My App"
   ) → { app_uuid, public_key }
5. github_add_deploy_key(repo="AlobarQuest/my-app", public_key=...)
6. coolify_set_compose_config(
     uuid=app_uuid,
     domains={"api": "https://my-app.devonwatkins.com"},
     compose_location="/docker-compose.yml"
   )
7. coolify_bulk_create_app_envs(uuid=app_uuid, variables=[...])  # now works for compose
8. namecheap_dns_add_record(domain="devonwatkins.com", name="my-app", type="A", address="178.156.247.239")
9. coolify_deploy(uuid=app_uuid, force=true)
```

Zero manual DB access. Zero tinker. Zero Coolify UI.
