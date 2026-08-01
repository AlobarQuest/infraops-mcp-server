# Secrets Remediation Plan

> Created: 2026-03-20
> Updated: 2026-03-22 — Added tiered secrets policy (BWS for shared + API keys; Coolify-direct for app-generated secrets)
> Status: Phase 1A COMPLETE. Phase 1B revised per tiered policy. Phases 2-5 ready for execution.
> Reference: /Users/devon/Projects/infraops-mcp-server/docs/secrets-inventory.md

---

## Consolidation Decisions (locked in)

| Decision             | Result                                                                  |
| -------------------- | ----------------------------------------------------------------------- |
| GitHub PATs          | ONE PAT — scopes: repo, read:packages, write:packages                   |
| Anthropic API Keys   | ONE key — shared across all apps                                        |
| Google OAuth         | ONE client ID/secret — multiple redirect URIs per app                   |
| Coolify API Token    | ONE token — verify all consumers use the same, consolidate in BWS       |
| Cloudflare API Token | Verify if AdjustRight and inframanager use the same — consolidate if so |

---

## Tiered Secrets Policy

Not all secrets need to live in BWS. Secrets are classified into two tiers:

**Tier 1 — BWS:** Secrets issued by third parties, shared across apps, or organizationally critical.

- Shared secrets consumed by multiple apps (GitHub PAT, Anthropic API key, Google OAuth)
- All API keys, even single-app (Resend, Fal.ai, Google Maps, videocreator)
- Infrastructure tokens (Coolify API, Cloudflare, Hetzner)

**Tier 2 — Coolify-direct:** App-generated secrets (regenerable via `openssl rand -hex 32`), scoped to one app.

- Database passwords, session secrets, secret keys
- Webhook signing secrets, internal auth tokens, OAuth state secrets

**Decision rule:** "Was this issued by a third party?" → BWS. "Can I regenerate it myself?" → Coolify-direct.

Tier 2 secrets are documented in `docs/secrets-inventory.md` with status `IN_COOLIFY` (not `IN_BWS`).

---

## Phase 1: Create BWS Structure and Generate New Secrets

Before touching any app, create the BWS entries for Tier 1 secrets. Tier 2 secrets will be generated and set directly in Coolify during Phase 3 app remediation.

### 1A. Shared Secrets (create in BWS)

| BWS Path                              | Action                                                                                          | Consumers                                                     |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `shared/github-pat`                   | Generate new PAT at github.com/settings/tokens with scopes: repo, read:packages, write:packages | mirror, inframanager, AdjustRight CI/CD, lifeops-portal CI/CD |
| `shared/anthropic-api-key`            | Generate new key at console.anthropic.com                                                       | MealPlanning, video-creator, inbox-assistant, inframanager    |
| `shared/google-oauth-client-id`       | Use existing client ID (or create new one in Google Cloud Console)                              | BookingAssistant, Contacts, inbox-assistant                   |
| `shared/google-oauth-client-secret`   | Regenerate secret for the OAuth client                                                          | BookingAssistant, Contacts, inbox-assistant                   |
| `shared/bitbucket-token`              | Generate new app password at bitbucket.org/account/settings/app-passwords                       | mirror                                                        |
| `shared/lifeops-internal-api-token`   | Generate: `openssl rand -hex 32`                                                                | inbox-assistant (sender), lifeops-portal (validator)          |
| `shared/contacts-basic-auth-username` | Set value (shared between inbox-assistant and Contacts)                                         | inbox-assistant (sender), Contacts (validator)                |
| `shared/contacts-basic-auth-password` | Generate: `openssl rand -hex 32`                                                                | inbox-assistant (sender), Contacts (validator)                |
| `infra/coolify-api-token`             | Verify current tokens match, then store one                                                     | inframanager, lifeops-portal CI/CD, infraops-mcp              |
| `infra/cloudflare-api-token`          | Verify scope compatibility, generate new if needed                                              | inframanager, AdjustRight CI/CD                               |
| `infra/hetzner-api-token`             | Already in BWS                                                                                  | infraops-mcp                                                  |

### 1B. Per-App Secrets (tiered — BWS for API keys, Coolify-direct for app-generated)

For each secret below, **Tier** indicates where it lives:

- **T1** = BWS (General Infrastructure project) — API keys and third-party-issued secrets
- **T2** = Coolify-direct — app-generated secrets, documented in `secrets-inventory.md`

**BookingAssistant:**

| Secret                | Tier | Action                                                                             |
| --------------------- | ---- | ---------------------------------------------------------------------------------- |
| `secret-key`          | T2   | Generate: `openssl rand -hex 32` → set in Coolify                                  |
| `google-redirect-uri` | T2   | Value: `https://booking.devonwatkins.com/admin/google/callback` → set in Coolify   |
| `google-maps-api-key` | T1   | Regenerate in Google Cloud Console, restrict to Distance Matrix API + domain → BWS |
| `webhook-secret`      | T2   | Generate: `openssl rand -hex 32` (replaces Red57Chair!01) → set in Coolify         |
| `resend-api-key`      | T1   | Regenerate at resend.com → BWS                                                     |

**BookingAssistant Preview:**

| Secret                        | Tier | Action                                                                                   |
| ----------------------------- | ---- | ---------------------------------------------------------------------------------------- |
| `preview-google-redirect-uri` | T2   | Value: `https://preview.booking.devonwatkins.com/admin/google/callback` → set in Coolify |
| `preview-admin-password`      | T2   | Existing GitHub Actions secret → set in Coolify                                          |

**Contacts (ContactHub):**

| Secret                            | Tier | Action                                                                    |
| --------------------------------- | ---- | ------------------------------------------------------------------------- |
| `postgres-password`               | T2   | Generate: `openssl rand -hex 32` (replaces "contacthub") → set in Coolify |
| `google-oauth-redirect-uri`       | T2   | Value: computed from APP_BASE_URL → set in Coolify                        |
| `sched-auth-user`                 | T2   | Can match BASIC_AUTH_USERNAME or be separate → set in Coolify             |
| `sched-auth-pass`                 | T2   | Can match BASIC_AUTH_PASSWORD or be separate → set in Coolify             |
| `google-outbound-proxy-url`       | T2   | Current value (contains embedded creds) → set in Coolify                  |
| `carddav-outbound-proxy-url`      | T2   | Current value if set → set in Coolify                                     |
| `followupboss-outbound-proxy-url` | T2   | Current value if set → set in Coolify                                     |

**inbox-assistant:**

| Secret                          | Tier | Action                                                                                    |
| ------------------------------- | ---- | ----------------------------------------------------------------------------------------- |
| `postgres-password`             | T2   | Generate: `openssl rand -hex 32` (CRITICAL — replaces "inbox_assistant") → set in Coolify |
| `operator-credentials-json`     | T2   | Regenerate with strong password → set in Coolify                                          |
| `google-redirect-uri`           | T2   | Value: `https://inboxai.devonwatkins.com/integrations/google/callback` → set in Coolify   |
| `google-calendar-refresh-token` | T2   | Current value (cannot regenerate — must migrate as-is) → set in Coolify                   |
| `oauth-state-secret`            | T2   | Generate: `openssl rand -hex 32` (replaces "development-only-change-me") → set in Coolify |
| `alert-webhook-url`             | T2   | Current value if set → set in Coolify                                                     |

**lifeops-portal:**

| Secret           | Tier | Action                                                                            |
| ---------------- | ---- | --------------------------------------------------------------------------------- |
| `auth-password`  | T2   | Generate: `openssl rand -hex 32` → set in Coolify                                 |
| `session-secret` | T2   | Generate: `openssl rand -hex 32` → set in Coolify                                 |
| `database-url`   | T2   | Reconstruct with LifeOpsPortalPostgres password (already strong) → set in Coolify |

**MealPlanning:**

| Secret         | Tier | Action                                            |
| -------------- | ---- | ------------------------------------------------- |
| `app-password` | T2   | Generate: `openssl rand -hex 32` → set in Coolify |
| `secret-key`   | T2   | Generate: `openssl rand -hex 32` → set in Coolify |

**video-creator:**

| Secret                 | Tier | Action                                                                       |
| ---------------------- | ---- | ---------------------------------------------------------------------------- |
| `videocreator-api-key` | T2   | Generate: `openssl rand -hex 32` (self-issued API auth key) → set in Coolify |
| `fal-key`              | T1   | Regenerate at fal.ai → BWS                                                   |

**infra-brain:**

| Secret              | Tier | Action                                            |
| ------------------- | ---- | ------------------------------------------------- |
| `postgres-password` | T2   | Generate: `openssl rand -hex 32` → set in Coolify |

**LifeOpsPortalPostgres (Coolify DB resource):**

| Secret                       | Tier | Action                                                                  |
| ---------------------------- | ---- | ----------------------------------------------------------------------- |
| `postgres-resource-password` | T2   | Keep existing (already strong random), document in secrets-inventory.md |

---

## Phase 2: Google OAuth Consolidation

Before rotating app secrets, consolidate Google OAuth since three apps depend on it.

1. Go to Google Cloud Console → APIs & Services → Credentials
2. Identify which OAuth 2.0 client IDs exist for BookingAssistant, Contacts, inbox-assistant
3. Choose one client (or create a new one) to be the shared client
4. Add ALL redirect URIs to this one client:
   - `https://booking.devonwatkins.com/admin/google/callback`
   - `https://preview.booking.devonwatkins.com/admin/google/callback`
   - `https://contacts.devonwatkins.com/...` (verify exact path from Contacts code)
   - `https://inboxai.devonwatkins.com/integrations/google/callback`
5. Regenerate the client secret
6. Store client ID and new secret in BWS (`shared/google-oauth-client-id`, `shared/google-oauth-client-secret`)
7. Note: the old client secrets are now invalidated — all three apps will need updating in the same session

---

## Phase 3: App-by-App Remediation

Process for EACH app:

1. Open Claude Code in the project repo
2. Give the agent the remediation prompt (below)
3. Agent reads secrets-inventory.md and this plan
4. Agent makes code changes if needed (env var names, config loading)
5. Test locally
6. Deploy
7. Update Coolify env vars via infraops MCP with BWS-injected values
8. Verify app works
9. Update secrets-inventory.md status: EXPOSED → IN_BWS

### Order of execution (by risk/dependency):

**Round 1 — Fix critical weaknesses:**

| #   | App             | Why first                     | Key issues                                                |
| --- | --------------- | ----------------------------- | --------------------------------------------------------- |
| 1   | inbox-assistant | DB password = username        | New postgres password, oauth-state-secret, operator creds |
| 2   | Contacts        | Hardcoded DB creds in compose | Remove hardcoded values, use env var substitution         |

**Round 2 — Rotate exposed secrets:**

| #   | App              | Key issues                                                          |
| --- | ---------------- | ------------------------------------------------------------------- |
| 3   | BookingAssistant | Switch to main branch, rotate webhook secret, fix health check host |
| 4   | MealPlanning     | Rotate app password, secret key, Anthropic key                      |
| 5   | video-creator    | Rotate Fal key, Anthropic key, videocreator key                     |

**Round 3 — Update healthy apps to use BWS:**

| #   | App            | Key issues                                                               |
| --- | -------------- | ------------------------------------------------------------------------ |
| 6   | lifeops-portal | Fix :latest Docker tag, rotate auth/session secrets, update DATABASE_URL |
| 7   | infra-brain    | Rotate postgres password                                                 |

**Round 4 — CI/CD and external:**

| #   | App                  | Key issues                                                        |
| --- | -------------------- | ----------------------------------------------------------------- |
| 8   | lifeops-portal CI/CD | Update GitHub Actions secrets to use consolidated tokens          |
| 9   | AdjustRight CI/CD    | Update GitHub Actions secrets, verify Cloudflare/Supabase tokens  |
| 10  | mirror               | Update to use consolidated GitHub PAT and rotated Bitbucket token |

---

## Phase 4: Rotate the BWS Access Token

After ALL apps are migrated and verified:

1. Generate new BWS machine account token
2. Update inframanager's Coolify env var with new token
3. Update infraops-mcp start.sh config (BWS_COOLIFY_SECRET_ID may need updating if using a different BWS machine account)
4. Restart inframanager, verify all syncs work
5. Revoke old BWS access token
6. Verify no app breaks

---

## Phase 5: Cleanup and Verification

1. Remove stale env vars flagged by agents:
   - BookingAssistant: OAUTH_REDIRECT_URI (agent says unused)
   - BookingAssistant: ADMIN_EMAIL (agent says unused)
2. Verify LIFEOPS_INTERNAL_API_TOKEN vs LIFEOPS_API_TOKEN naming mismatch (agent flagged in inventory)
3. Run the full infrastructure audit prompt again — zero EXPOSED secrets should remain
4. Update secrets-inventory.md: all statuses should be IN_BWS (Tier 1) or IN_COOLIFY (Tier 2)
5. Add a lesson to infra-brain documenting the BWS injection pattern for future apps

---

## Agent Prompt Template

Use this prompt in Claude Code when remediating each app:

```
CONTEXT: I'm migrating this app's secrets to BWS as part of a portfolio-wide remediation.

Read these files for context:
- /Users/devon/Projects/infraops-mcp-server/docs/secrets-inventory.md (full secrets inventory)
- /Users/devon/Projects/infraops-mcp-server/docs/secrets-remediation-plan.md (the plan)

TASK for [APP_NAME]:

1. Read the secrets inventory and find all secrets listed for this app.
2. Search the codebase to verify how each secret is loaded (env var name, config file, default values).
3. Identify any code changes needed to support BWS injection via Coolify env vars. Common changes:
   - Remove hardcoded credentials from docker-compose.yml (use ${VAR} substitution)
   - Remove insecure defaults (like "development-only-change-me")
   - Fix env var naming mismatches between code and Coolify
4. List the exact Coolify env var updates needed (name, new value source from BWS).
5. Flag any secrets that should be rotated at the provider (Google, GitHub, etc.)
6. Propose a plan. Do NOT execute until I approve.

After I approve and you execute:
7. Update /Users/devon/Projects/infraops-mcp-server/docs/secrets-inventory.md — change status from EXPOSED/HARDCODED/PENDING to IN_BWS (Tier 1 secrets stored in BWS) or IN_COOLIFY (Tier 2 secrets set directly in Coolify) for each secret you've migrated.
   - Tier 1 (BWS): API keys and third-party-issued secrets
   - Tier 2 (Coolify-direct): App-generated secrets (DB passwords, session keys, webhook secrets, internal auth tokens)
```

Replace `[APP_NAME]` with the actual app name for each round.
