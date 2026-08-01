# Secrets Inventory

> **Purpose:** Single source of truth for all secrets across Devon's infrastructure.
> Multiple AI agents should reference this file when working with secrets.
> Updated: 2026-03-20 | Source: Infrastructure audit 2026-03-19, BookingAssistant agent audit 2026-03-20, App Brain agent audit 2026-03-20, InboxAssistant agent audit 2026-03-20, followupboss-mcp-server agent audit 2026-03-20, infraops-mcp-server agent audit 2026-03-20, InfraManager agent audit 2026-03-20

## Status Legend

| Status    | Meaning                                                      |
| --------- | ------------------------------------------------------------ |
| EXPOSED   | Plaintext in Coolify env vars, visible via API. Must rotate. |
| IN_BWS    | Stored in BWS, injected at runtime. Secure.                  |
| HARDCODED | Hardcoded in code or compose file. Must migrate.             |
| PENDING   | Not yet assessed or migrated.                                |

## Classification Legend

| Class          | Meaning                                                      | Sharing Rule                             |
| -------------- | ------------------------------------------------------------ | ---------------------------------------- |
| SHARED_OK      | Same secret legitimately used by multiple apps               | One BWS secret, multiple consumers       |
| PER_PROVIDER   | Same external provider, but use separate credentials per app | One BWS secret per app                   |
| PER_APP_UNIQUE | Must be unique to each app                                   | Generate unique per app, never share     |
| INFRA          | Infrastructure-level secret, not app-specific                | One BWS secret, used by infra tools only |

---

## 1. GitHub Tokens

| App          | Env Var      | Status  | Class     | Notes                                                                                                                                              |
| ------------ | ------------ | ------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| mirror       | GITHUB_TOKEN | EXPOSED | SHARED_OK | GitHub PAT for repo mirroring. Same PAT could serve all GitHub API needs if scoped correctly.                                                      |
| inframanager | GH_TOKEN     | EXPOSED | SHARED_OK | GitHub PAT. Likely same purpose as above — consolidation candidate.                                                                                |
| AdjustRight  | GH_TOKEN     | PENDING | SHARED_OK | GitHub PAT used in .github/scripts/export-project.js for GitHub Projects API. Stored as GitHub Actions secret. Consolidation candidate with above. |

**Consolidation recommendation:** Create ONE GitHub PAT with scopes: `repo`, `read:packages`, `write:packages`. Store in BWS. Use across mirror, inframanager, and CI/CD. Rotate the two exposed PATs immediately.

---

## 2. Bitbucket Token

| App    | Env Var         | Status  | Class     | Notes                                                                |
| ------ | --------------- | ------- | --------- | -------------------------------------------------------------------- |
| mirror | BITBUCKET_TOKEN | EXPOSED | SHARED_OK | Bitbucket App Password for mirror push. Only one consumer currently. |

**Action:** Rotate, store in BWS. Single consumer so no consolidation needed.

---

## 3. BWS Access Token

| App          | Env Var          | Status  | Class | Notes                                                   |
| ------------ | ---------------- | ------- | ----- | ------------------------------------------------------- |
| inframanager | BWS_ACCESS_TOKEN | EXPOSED | INFRA | The master key to all other secrets. CRITICAL exposure. |

**Action:** Rotate IMMEDIATELY. This token should never be in Coolify env vars. For the infraops MCP, it's injected via .claude.json → start.sh, which is the correct pattern. Inframanager needs a different injection method.

---

## 4. Anthropic API Keys

| App             | Env Var                | Status  | Class     | Notes                                                                                                                                                                                        |
| --------------- | ---------------------- | ------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MealPlanning    | CLAUDE_API_KEY         | EXPOSED | SHARED_OK | Anthropic API key for AI features.                                                                                                                                                           |
| video-creator   | ANTHROPIC_API_KEY      | EXPOSED | SHARED_OK | Anthropic API key for AI features.                                                                                                                                                           |
| inbox-assistant | ANTHROPIC_API_KEY      | PENDING | SHARED_OK | Anthropic API key for AI classification fallback (claude-haiku-4-5-20251001). Used in config.py:158. Consolidation candidate with MealPlanning and video-creator keys.                       |
| inframanager    | INFRAMAN_ANTHROPIC_API | IN_BWS  | SHARED_OK | Anthropic API key for project analysis (claude-sonnet-4-6). Retrieved from BWS via load_all_secrets(). Used in discovery/analyzer.py:255 and routers/analyze.py:19. Consolidation candidate. |

**Consolidation recommendation:** One Anthropic API key for all apps. Same account, same billing. No security benefit to separate keys since Anthropic doesn't support per-key scoping. Store in BWS as a shared secret.

---

## 5. Google OAuth Credentials

| App                                                                                                                                                                                                                      | Env Var                                       | Status  | Class          | Notes                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | ------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| BookingAssistant                                                                                                                                                                                                         | GOOGLE_CLIENT_ID                              | EXPOSED | PER_PROVIDER   | Google OAuth client ID                                                                                                                   |
| BookingAssistant                                                                                                                                                                                                         | GOOGLE_CLIENT_SECRET                          | EXPOSED | PER_PROVIDER   | Google OAuth client secret                                                                                                               |
| BookingAssistant                                                                                                                                                                                                         | OAUTH_REDIRECT_URI                            | EXPOSED | PER_APP_UNIQUE | App-specific callback URL                                                                                                                |
| AGENT NOTE (BookingAssistant, 2026-03-20): OAUTH_REDIRECT_URI not found in codebase (not in config.py or any .py file). App only uses GOOGLE_REDIRECT_URI. May be a stale Coolify env var — verify and remove if unused. |
| BookingAssistant                                                                                                                                                                                                         | GOOGLE_REDIRECT_URI                           | EXPOSED | PER_APP_UNIQUE | App-specific callback URL                                                                                                                |
| Contacts                                                                                                                                                                                                                 | GOOGLE_CLIENT_SECRET                          | EXPOSED | PER_PROVIDER   | Google OAuth client secret                                                                                                               |
| Contacts                                                                                                                                                                                                                 | GOOGLE_CLIENT_ID                              | PENDING | PER_PROVIDER   | Google OAuth client ID. Used in src/config.py and OAuth flow (routes_integrations.py). Not yet in inventory.                             |
| Contacts                                                                                                                                                                                                                 | GOOGLE_OAUTH_REDIRECT_URI                     | PENDING | PER_APP_UNIQUE | OAuth callback URL. Configured in src/config.py, used in routes_integrations.py. Computed from APP_BASE_URL if not set.                  |
| inbox-assistant                                                                                                                                                                                                          | INBOX_ASSISTANT_GOOGLE_CLIENT_SECRET          | EXPOSED | PER_PROVIDER   | Google OAuth client secret                                                                                                               |
| inbox-assistant                                                                                                                                                                                                          | INBOX_ASSISTANT_GOOGLE_CLIENT_ID              | PENDING | PER_PROVIDER   | Google OAuth client ID. Required alongside client_secret and redirect_uri (config.py:128).                                               |
| inbox-assistant                                                                                                                                                                                                          | INBOX_ASSISTANT_GOOGLE_REDIRECT_URI           | PENDING | PER_APP_UNIQUE | OAuth callback URL. Default: `https://inboxai.devonwatkins.com/integrations/google/callback` (docker-compose.yml:49).                    |
| inbox-assistant                                                                                                                                                                                                          | INBOX_ASSISTANT_GOOGLE_CALENDAR_REFRESH_TOKEN | PENDING | PER_APP_UNIQUE | OAuth refresh token granting persistent Google Calendar access. CRITICAL — equivalent to long-lived calendar credential (config.py:126). |

**Consolidation recommendation:** This is nuanced. You COULD use one Google OAuth client across all apps (same client ID and secret) with multiple authorized redirect URIs registered in Google Cloud Console. This simplifies management. However, if any single app's credentials leak, all apps' OAuth flows are compromised. Decision: **share the Google Cloud project, but evaluate whether one OAuth client with multiple redirect URIs works for your use case.** Each app still needs its own redirect URI env vars (those are PER_APP_UNIQUE).

---

## 6. Google Maps API Key

| App              | Env Var             | Status  | Class     | Notes                                                          |
| ---------------- | ------------------- | ------- | --------- | -------------------------------------------------------------- |
| BookingAssistant | GOOGLE_MAPS_API_KEY | EXPOSED | SHARED_OK | Used for drive time calculations. Only one consumer currently. |

**Action:** Rotate, store in BWS. Restrict the key in Google Cloud Console to the BookingAssistant domain and the Distance Matrix API only.

---

## 7. App Auth Passwords (user-facing login)

| App                                                                                                                                                                                                                    | Env Var                                   | Status  | Class          | Notes                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------- | -------------- | -------------------------------------------------------------------------------------------------------------------- |
| MealPlanning                                                                                                                                                                                                           | APP_PASSWORD                              | EXPOSED | PER_APP_UNIQUE | Simple auth password for the app                                                                                     |
| inframanager                                                                                                                                                                                                           | HTTP Basic Auth password                  | EXPOSED | PER_APP_UNIQUE | Traefik-level basic auth. Value: Cat!7Ballcap                                                                        |
| AGENT NOTE (inframanager, 2026-03-20): HTTP Basic Auth password not found in InfraManager codebase — configured at Traefik/Coolify middleware level, not in application code. Confirmed legitimate external injection. |
| Contacts                                                                                                                                                                                                               | BASIC_AUTH_PASSWORD                       | EXPOSED | PER_APP_UNIQUE | App-level basic auth. Value: Red57Chair!                                                                             |
| Contacts                                                                                                                                                                                                               | BASIC_AUTH_USERNAME                       | PENDING | PER_APP_UNIQUE | Basic auth username. Required when BASIC_AUTH_ENABLED=true (src/config.py). Not yet in inventory.                    |
| Contacts                                                                                                                                                                                                               | SCHED_AUTH_USER                           | PENDING | PER_APP_UNIQUE | Scheduler sidecar auth user for health checks. Falls back to BASIC_AUTH_USERNAME (scripts/scheduler_sidecar.py).     |
| Contacts                                                                                                                                                                                                               | SCHED_AUTH_PASS                           | PENDING | PER_APP_UNIQUE | Scheduler sidecar auth password for health checks. Falls back to BASIC_AUTH_PASSWORD (scripts/scheduler_sidecar.py). |
| lifeops-portal                                                                                                                                                                                                         | AUTH_PASSWORD                             | EXPOSED | PER_APP_UNIQUE | Portal login password                                                                                                |
| inbox-assistant                                                                                                                                                                                                        | INBOX_ASSISTANT_OPERATOR_CREDENTIALS_JSON | EXPOSED | PER_APP_UNIQUE | JSON with operator username/password                                                                                 |

**Consolidation recommendation:** NEVER share auth passwords across apps. Each must be unique. However, consider whether all these apps actually need custom password auth vs a shared auth mechanism (e.g., a simple SSO proxy in front of all internal tools). That's a bigger architectural decision for later. For now: rotate each, store each in BWS separately.

---

## 8. App Secret Keys (session signing, CSRF)

| App              | Env Var                            | Status  | Class          | Notes                                                                                                                                          |
| ---------------- | ---------------------------------- | ------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| MealPlanning     | SECRET_KEY                         | EXPOSED | PER_APP_UNIQUE | Flask/app secret for session signing                                                                                                           |
| BookingAssistant | SECRET_KEY                         | EXPOSED | PER_APP_UNIQUE | FastAPI secret key                                                                                                                             |
| lifeops-portal   | SESSION_SECRET                     | EXPOSED | PER_APP_UNIQUE | Session signing key                                                                                                                            |
| inbox-assistant  | INBOX_ASSISTANT_OAUTH_STATE_SECRET | PENDING | PER_APP_UNIQUE | HMAC-SHA256 signing key for OAuth state parameter. Default is `development-only-change-me` — MUST be overridden in production (config.py:127). |

**Consolidation recommendation:** NEVER share. These must be unique per app. If two apps share a SECRET_KEY and one is compromised, the attacker can forge sessions for both. Generate a cryptographically random value for each. Store in BWS separately.

---

## 9. Database Passwords

| App                                                                                                                                                                                                                                                                                                                          | Env Var                        | Status    | Class          | Notes                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | --------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contacts                                                                                                                                                                                                                                                                                                                     | POSTGRES_PASSWORD (in compose) | HARDCODED | PER_APP_UNIQUE | Value: contacthub. Hardcoded in docker-compose.yml, not using env var substitution.                                                                                       |
| Contacts                                                                                                                                                                                                                                                                                                                     | DATABASE_URL (in compose)      | HARDCODED | PER_APP_UNIQUE | Contains password inline in connection string                                                                                                                             |
| AGENT NOTE (Contacts, 2026-03-20): DATABASE_URL is hardcoded in docker-compose.yml in 3 places (api, worker, scheduler services) AND as a default in src/config.py. The docker-compose hardcoded values override the .env file loaded via env_file. Consider removing hardcoded values and relying solely on .env injection. |
| Contacts                                                                                                                                                                                                                                                                                                                     | REDIS_URL                      | PENDING   | PER_APP_UNIQUE | Redis connection string. Default `redis://redis:6379/0` (no auth). Hardcoded in docker-compose.yml for api, worker, and scheduler services. Used in src/workers/queue.py. |
| inbox-assistant                                                                                                                                                                                                                                                                                                              | POSTGRES_PASSWORD              | EXPOSED   | PER_APP_UNIQUE | Value: inbox_assistant (same as username — weak!)                                                                                                                         |
| infra-brain                                                                                                                                                                                                                                                                                                                  | POSTGRES_PASSWORD              | EXPOSED   | PER_APP_UNIQUE | Properly random, but plaintext in Coolify                                                                                                                                 |
| lifeops-portal                                                                                                                                                                                                                                                                                                               | DATABASE_URL                   | EXPOSED   | PER_APP_UNIQUE | Contains password inline                                                                                                                                                  |
| LifeOpsPortalPostgres                                                                                                                                                                                                                                                                                                        | postgres_password              | EXPOSED   | PER_APP_UNIQUE | Coolify DB resource config, properly random                                                                                                                               |
| AGENT NOTE (lifeops-portal, 2026-03-20): postgres_password not directly referenced in AlobarDashboard codebase — injected by Coolify into DATABASE_URL at runtime. Confirmed legitimate external injection.                                                                                                                  |

**Consolidation recommendation:** NEVER share database passwords. Each database gets its own strong random password. Fix inbox-assistant immediately (password = username is unacceptable). Move Contacts from hardcoded to env var substitution in compose. All passwords stored in BWS.

---

## 10. Internal API Tokens (app-to-app)

| App                                                                                                                                                                                                                                                                          | Env Var                      | Status  | Class          | Notes                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| inbox-assistant                                                                                                                                                                                                                                                              | LIFEOPS_INTERNAL_API_TOKEN   | EXPOSED | SHARED_OK      | Token for inbox-assistant to call lifeops-portal API                                                                                                          |
| AGENT NOTE (inbox-assistant, 2026-03-20): In codebase, this env var is named LIFEOPS_API_TOKEN (config.py:157), sent as `X-LifeOps-Token` header (lifeops_client.py:68). Inventory name LIFEOPS_INTERNAL_API_TOKEN may reflect the Coolify env var name — verify they match. |
| inbox-assistant                                                                                                                                                                                                                                                              | CONTACTS_BASIC_AUTH_USERNAME | PENDING | SHARED_OK      | Username for HTTP Basic Auth to ContactHub API. Same credential ContactHub validates (config.py:154, contacts_client.py:66).                                  |
| inbox-assistant                                                                                                                                                                                                                                                              | CONTACTS_BASIC_AUTH_PASSWORD | PENDING | SHARED_OK      | Password for HTTP Basic Auth to ContactHub API. Same credential ContactHub validates (config.py:155, contacts_client.py:66).                                  |
| lifeops-portal                                                                                                                                                                                                                                                               | INTERNAL_API_TOKEN           | EXPOSED | SHARED_OK      | Token that lifeops-portal validates on incoming requests                                                                                                      |
| app-brain                                                                                                                                                                                                                                                                    | BRAIN_KEY                    | PENDING | PER_APP_UNIQUE | API auth key for app-brain-mcp. Validated via x-brain-key header, Bearer token, or ?key= query param. Timing-safe comparison. Set via `supabase secrets set`. |
| app-brain                                                                                                                                                                                                                                                                    | INTERNAL_ONBOARD_KEY         | PENDING | PER_APP_UNIQUE | Function-to-function auth token. app-brain-mcp sends as Bearer token when calling onboard-app worker. Timing-safe comparison. Set via `supabase secrets set`. |

**Consolidation recommendation:** These ARE the same token — one app sends it, the other validates it. One BWS secret, two consumers. This is correct architecture, just needs to move to BWS.

---

## 11. Webhook Secrets

| App              | Env Var                      | Status  | Class          | Notes                                             |
| ---------------- | ---------------------------- | ------- | -------------- | ------------------------------------------------- |
| BookingAssistant | manual_webhook_secret_github | EXPOSED | PER_APP_UNIQUE | Value: Red57Chair!01. Human-readable, not random. |

**Action:** Generate a proper random webhook secret (e.g., `openssl rand -hex 32`). Store in BWS. Update GitHub webhook config to match.

---

## 12. Supabase Credentials

| App         | Env Var                   | Status  | Class          | Notes                                                                                                                                                                                                                                                  |
| ----------- | ------------------------- | ------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AdjustRight | SUPABASE_SERVICE_ROLE_KEY | PENDING | PER_APP_UNIQUE | Supabase service role key — full admin access. Used in 6+ Cloudflare Pages functions (admin-actions, admin-data, community-data, bootstrap-admin, classify-claude, dropbox/*). Stored as Cloudflare Pages env var. CRITICAL — must never reach client. |
| app-brain   | SUPABASE_SERVICE_ROLE_KEY | PENDING | PER_APP_UNIQUE | Auto-injected by Supabase Edge Functions runtime. Used to initialize Supabase client for DB access. Not manually managed — inherent to Supabase project (ref: eicpckigypmnuplysbca).                                                                   |

**Action:** Ensure this is set as an encrypted environment variable in Cloudflare Pages (not plaintext). Verify it's only accessible in server-side functions. Consider BWS injection if Cloudflare supports it.

---

## 13. Dropbox OAuth Credentials

| App         | Env Var            | Status  | Class          | Notes                                                                                                                                                         |
| ----------- | ------------------ | ------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AdjustRight | DROPBOX_APP_SECRET | PENDING | PER_APP_UNIQUE | Dropbox OAuth app secret for token exchange. Used in functions/dropbox/access-token.ts and functions/dropbox/callback.ts. Stored as Cloudflare Pages env var. |

**Action:** Ensure stored as encrypted env var in Cloudflare Pages. Rotate if ever exposed.

---

## 14. Cloudflare Credentials

| App          | Env Var              | Status  | Class | Notes                                                                                                                            |
| ------------ | -------------------- | ------- | ----- | -------------------------------------------------------------------------------------------------------------------------------- |
| AdjustRight  | CF_API_TOKEN         | PENDING | INFRA | Cloudflare API token used in .github/scripts/cleanup-pages.js for Pages deployment cleanup. Stored as GitHub Actions secret.     |
| inframanager | CLOUDFLARE_API_TOKEN | IN_BWS  | INFRA | Cloudflare API Bearer token for DNS zone sync. Retrieved from BWS via load_all_secrets(). Used in backend/sync/cloudflare.py:84. |

**Action:** Verify token has minimal scopes (Pages read/write only). Store in BWS if centralizing CI/CD secrets.

---

## 15. Test Credentials

| App              | Env Var                      | Status  | Class          | Notes                                                                                                                       |
| ---------------- | ---------------------------- | ------- | -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| AdjustRight      | DPP_TEST_PASSWORD            | PENDING | PER_APP_UNIQUE | Password for test user account used in Playwright E2E tests. Stored as GitHub Actions secret.                               |
| AdjustRight      | DPP_GEMINI_API_KEY           | PENDING | PER_APP_UNIQUE | Google Gemini API key for E2E smoke tests. Stored as GitHub Actions secret. Should be a test-only key, not production.      |
| BookingAssistant | PREVIEW_ADMIN_PASSWORD       | PENDING | PER_APP_UNIQUE | Admin password for preview environment UAT. Required GitHub Actions repo secret. Used in .github/workflows/preview-uat.yml. |
| BookingAssistant | PREVIEW_WEBHOOK_RECEIVER_URL | PENDING | PER_APP_UNIQUE | Webhook test receiver URL for preview UAT. Optional GitHub Actions repo secret.                                             |
| BookingAssistant | PREVIEW_WEBHOOK_EVENTS_URL   | PENDING | PER_APP_UNIQUE | Webhook events endpoint for preview UAT. Optional GitHub Actions repo secret.                                               |
| BookingAssistant | PREVIEW_WEBHOOK_EVENTS_TOKEN | PENDING | PER_APP_UNIQUE | Token for accessing webhook events in preview UAT. Optional GitHub Actions repo secret.                                     |

**Action:** Ensure these are test-only credentials with no production access. Rotate periodically.

---

## 16. Third-Party API Keys

| App                     | Env Var                           | Status  | Class          | Notes                                                                                                                                                                                                                                        |
| ----------------------- | --------------------------------- | ------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| video-creator           | VIDEOCREATOR_API_KEY              | EXPOSED | PER_APP_UNIQUE | Unknown provider API key                                                                                                                                                                                                                     |
| video-creator           | FAL_KEY                           | EXPOSED | PER_APP_UNIQUE | Fal.ai API key for AI video generation                                                                                                                                                                                                       |
| Contacts                | GOOGLE_OUTBOUND_PROXY_URL         | EXPOSED | PER_APP_UNIQUE | Contains proxy credentials in URL                                                                                                                                                                                                            |
| Contacts                | CARDDAV_OUTBOUND_PROXY_URL        | PENDING | PER_APP_UNIQUE | HTTP proxy for CardDAV connector. May contain embedded credentials in URL. Configured in src/config.py.                                                                                                                                      |
| Contacts                | FOLLOWUPBOSS_OUTBOUND_PROXY_URL   | PENDING | PER_APP_UNIQUE | HTTP proxy for Follow Up Boss connector. May contain embedded credentials in URL. Configured in src/config.py.                                                                                                                               |
| app-brain               | OPENROUTER_API_KEY                | PENDING | SHARED_OK      | OpenRouter API key for text-embedding-3-small (embeddings) and gpt-4o-mini (classification). Set via `supabase secrets set`. Could be shared if other apps use OpenRouter.                                                                   |
| BookingAssistant        | RESEND_API_KEY                    | PENDING | PER_APP_UNIQUE | Resend email API key (re_xxx format). Used in app/services/email.py, also overridable via admin settings DB. Set in Coolify env vars.                                                                                                        |
| inbox-assistant         | INBOX_ASSISTANT_ALERT_WEBHOOK_URL | PENDING | PER_APP_UNIQUE | Webhook URL for failure alerts (config.py:134). May contain embedded auth (e.g., Slack webhook URL).                                                                                                                                         |
| followupboss-mcp-server | FUB_API_KEY                       | PENDING | PER_APP_UNIQUE | Follow Up Boss API key (fka_ prefix). Used as HTTP Basic Auth username against api.followupboss.com/v1. Required — app exits if missing. Loaded from .env file or MCP host env config. Not deployed to Coolify — runs locally as MCP server. |

**Action:** Rotate each, store in BWS. These are all single-consumer and provider-specific.

---

## 17. CI/CD Deployment Secrets

| App                 | Env Var            | Status  | Class | Notes                                                                                                                                                                         |
| ------------------- | ------------------ | ------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| lifeops-portal      | COOLIFY_TOKEN      | PENDING | INFRA | Coolify API token for triggering deployments. Referenced as `secrets.COOLIFY_TOKEN` in `.github/workflows/publish-image.yml`. Stored as GitHub Actions repository secret.     |
| lifeops-portal      | COOLIFY_WEBHOOK    | PENDING | INFRA | Coolify webhook URL for triggering deployments. Referenced as `secrets.COOLIFY_WEBHOOK` in `.github/workflows/publish-image.yml`. Stored as GitHub Actions repository secret. |
| infraops-mcp-server | COOLIFY_API_TOKEN  | IN_BWS  | INFRA | Coolify Bearer token. Required — app exits if missing. Fetched from BWS via start.sh using BWS_COOLIFY_SECRET_ID. Used in src/services/coolify-client.ts.                     |
| infraops-mcp-server | HETZNER_API_TOKEN  | IN_BWS  | INFRA | Hetzner Cloud API token. Optional — Hetzner tools disabled if not set. Fetched from BWS via start.sh using BWS_HETZNER_SECRET_ID. Used in src/services/hetzner-client.ts.     |
| infraops-mcp-server | VPS_SSH_PASSPHRASE | IN_BWS  | INFRA | SSH key passphrase for VPS access. Optional. Fetched from BWS via start.sh using BWS_SSH_PASSPHRASE_SECRET_ID. Used in src/services/ssh-client.ts.                            |

**Action:** Verify these are set as encrypted GitHub Actions secrets. Consider centralizing Coolify deployment tokens in BWS if multiple apps use the same pattern.

---

## 19. Coolify API Credentials

| App          | Env Var         | Status | Class | Notes                                                                                                                                                                                                                                                        |
| ------------ | --------------- | ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| inframanager | COOLIFY_API_KEY | IN_BWS | INFRA | Coolify API Bearer token for infrastructure sync. Retrieved from BWS via load_all_secrets(). Used in backend/sync/coolify.py:41,53. Consolidation candidate with lifeops-portal COOLIFY_TOKEN and infraops-mcp-server COOLIFY_API_TOKEN — may be same token. |

**Action:** Verify whether inframanager, lifeops-portal, and infraops-mcp-server use the same Coolify API token. If so, consolidate to one BWS entry.

---

## 20. Namecheap API Credentials

| App          | Env Var            | Status | Class | Notes                                                                                                                     |
| ------------ | ------------------ | ------ | ----- | ------------------------------------------------------------------------------------------------------------------------- |
| inframanager | NAMECHEAP_API_USER | IN_BWS | INFRA | Namecheap API username for domain sync. Retrieved from BWS via load_all_secrets(). Used in backend/sync/namecheap.py:142. |
| inframanager | NAMECHEAP_API_KEY  | IN_BWS | INFRA | Namecheap API key for domain sync. Retrieved from BWS via load_all_secrets(). Used in backend/sync/namecheap.py:143.      |

**Action:** Single consumer currently. Already in BWS — no rotation needed unless compromised.

---

## 21. Non-Secret Configuration (no rotation needed)

These env vars were found during the audit but are NOT secrets. Included for completeness.

| App                                                                                                                                                                                                      | Env Var                                | Value                                                   | Notes                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| mirror                                                                                                                                                                                                   | GITHUB_USER                            | AlobarQuest                                             | Public username                                                                                                       |
| mirror                                                                                                                                                                                                   | BITBUCKET_WORKSPACE                    | alobarquest                                             | Public workspace name                                                                                                 |
| mirror                                                                                                                                                                                                   | BITBUCKET_EMAIL                        | devon.watkins@gmail.com                                 | Public email                                                                                                          |
| inframanager                                                                                                                                                                                             | INFRA_DATA_DIR                         | (path)                                                  | Config, not secret                                                                                                    |
| inframanager                                                                                                                                                                                             | ALLOWED_ORIGINS                        | (URLs)                                                  | Config, not secret                                                                                                    |
| inframanager                                                                                                                                                                                             | SYNC_NAMECHEAP_ENABLED                 | (bool)                                                  | Feature flag                                                                                                          |
| inframanager                                                                                                                                                                                             | SYNC_CLOUDFLARE_ENABLED                | (bool)                                                  | Feature flag                                                                                                          |
| inframanager                                                                                                                                                                                             | SYNC_GITHUB_ENABLED                    | (bool)                                                  | Feature flag                                                                                                          |
| inframanager                                                                                                                                                                                             | SYNC_BWS_ENABLED                       | (bool)                                                  | Feature flag                                                                                                          |
| inframanager                                                                                                                                                                                             | SYNC_COOLIFY_ENABLED                   | (bool)                                                  | Feature flag                                                                                                          |
| inframanager                                                                                                                                                                                             | SYNC_*_INTERVAL_MINUTES                | (int)                                                   | Sync interval per provider. Config, not secret                                                                        |
| inframanager                                                                                                                                                                                             | COOLIFY_URL                            | (URL, from BWS)                                         | Coolify instance URL. Retrieved from BWS but not a secret — just config                                               |
| inframanager                                                                                                                                                                                             | CLOUDFLARE_ACCOUNT_ID                  | (ID, from BWS)                                          | Cloudflare account ID. Retrieved from BWS but not a secret                                                            |
| inframanager                                                                                                                                                                                             | NAMECHEAP_CLIENT_IP                    | 178.156.247.239 (default)                               | Namecheap API client IP. Default is VPS IP. Config, not secret                                                        |
| MealPlanning                                                                                                                                                                                             | DB_PATH                                | /data/meal_planner.db                                   | Config path                                                                                                           |
| BookingAssistant                                                                                                                                                                                         | DATABASE_URL                           | sqlite:////data/booking.db                              | Config path (no password)                                                                                             |
| BookingAssistant                                                                                                                                                                                         | ADMIN_EMAIL                            | devon.watkins@gmail.com                                 | Config                                                                                                                |
| AGENT NOTE (BookingAssistant, 2026-03-20): ADMIN_EMAIL not found in codebase (not in config.py or any .py file). Set in Coolify but not consumed by the app. May be stale — verify and remove if unused. |
| BookingAssistant                                                                                                                                                                                         | GOOGLE_CLIENT_ID                       | (public ID)                                             | OAuth client IDs are not secret                                                                                       |
| Contacts                                                                                                                                                                                                 | APP_ENV                                | production                                              | Config                                                                                                                |
| Contacts                                                                                                                                                                                                 | DATABASE_URL (config.py default)       | postgresql+psycopg://contacthub:contacthub@…/contacthub | Dev default in config.py — overridden in production via env var. Not a secret leak, but default contains credentials. |
| Contacts                                                                                                                                                                                                 | REDIS_URL (config.py default)          | redis://redis:6379/0                                    | Dev default, no auth. Config, not secret.                                                                             |
| AdjustRight                                                                                                                                                                                              | VITE_SUPABASE_URL                      | (Supabase project URL)                                  | Public project URL, not secret                                                                                        |
| AdjustRight                                                                                                                                                                                              | VITE_SUPABASE_ANON_KEY                 | (Supabase anon key)                                     | Public anon key designed for browser use                                                                              |
| AdjustRight                                                                                                                                                                                              | VITE_DROPBOX_APP_KEY / DROPBOX_APP_KEY | (Dropbox app key)                                       | Public OAuth app ID                                                                                                   |
| AdjustRight                                                                                                                                                                                              | VITE_DROPBOX_REDIRECT_URI              | (redirect URL)                                          | OAuth callback URL, config not secret                                                                                 |
| AdjustRight                                                                                                                                                                                              | BOOTSTRAP_ADMIN_EMAIL                  | (email)                                                 | First-time admin setup, config not secret                                                                             |
| AdjustRight                                                                                                                                                                                              | CF_ACCOUNT_ID                          | (Cloudflare account ID)                                 | Account identifier, not secret                                                                                        |
| AdjustRight                                                                                                                                                                                              | CF_PAGES_PROJECT                       | (project name)                                          | Cloudflare Pages project name, config                                                                                 |
| AdjustRight                                                                                                                                                                                              | DPP_TEST_EMAIL                         | (test email)                                            | Test user email, not a secret                                                                                         |
| AdjustRight                                                                                                                                                                                              | PRIMARY_ADMIN_EMAIL                    | devon.watkins@gmail.com                                 | Hardcoded in 4 files as emergency fallback                                                                            |
| AdjustRight                                                                                                                                                                                              | CLAUDE_PROXY_RATE_LIMIT_PER_MINUTE     | 60 (default)                                            | Rate limit config, not secret                                                                                         |
| AdjustRight                                                                                                                                                                                              | BASE_URL                               | (production URL)                                        | Playwright test base URL, config                                                                                      |
| lifeops-portal                                                                                                                                                                                           | AUTH_EMAIL                             | devon.watkins@gmail.com                                 | Owner login email, config not secret                                                                                  |
| lifeops-portal                                                                                                                                                                                           | OWNER_EMAIL                            | devon.watkins@gmail.com                                 | DB seed fallback email, config not secret                                                                             |
| lifeops-portal                                                                                                                                                                                           | APP_NAME                               | LifeOpsPortal                                           | Health check identifier, config not secret                                                                            |
| app-brain                                                                                                                                                                                                | SUPABASE_URL                           | (Supabase project URL)                                  | Auto-injected by Supabase runtime. Used for DB client and worker endpoint URL. Not secret.                            |
| app-brain                                                                                                                                                                                                | ALLOWED_ORIGINS                        | (comma-separated URLs)                                  | Optional CORS whitelist. Empty/unset = allow all origins. Config, not secret.                                         |
| BookingAssistant                                                                                                                                                                                         | FROM_EMAIL                             | noreply@example.com (default)                           | Email sender address, config not secret                                                                               |
| BookingAssistant                                                                                                                                                                                         | TIMEZONE                               | America/New_York (default)                              | Default timezone, config not secret                                                                                   |
| BookingAssistant                                                                                                                                                                                         | UPLOAD_DIR                             | /data/uploads (default)                                 | File upload directory, config not secret                                                                              |
| BookingAssistant                                                                                                                                                                                         | SESSION_HTTPS_ONLY                     | False (default)                                         | Session cookie HTTPS flag, config not secret                                                                          |
| BookingAssistant                                                                                                                                                                                         | SESSION_SAME_SITE                      | lax (default)                                           | Session cookie SameSite policy, config not secret                                                                     |
| BookingAssistant                                                                                                                                                                                         | SESSION_COOKIE_NAME                    | booking_assistant_session (default)                     | Session cookie name, config not secret                                                                                |
| BookingAssistant                                                                                                                                                                                         | PREVIEW_BASE_URL                       | (preview URL)                                           | Preview UAT base URL, GitHub Actions env var                                                                          |
| BookingAssistant                                                                                                                                                                                         | PREVIEW_APPOINTMENT_TYPE_SLUG          | (slug)                                                  | Appointment type for UAT, GitHub Actions repo variable                                                                |
| followupboss-mcp-server                                                                                                                                                                                  | FUB_SAFE_MODE                          | true/false (default: false)                             | Boolean flag controlling whether delete tools are available. Not a secret — config only.                              |
| infraops-mcp-server                                                                                                                                                                                      | COOLIFY_BASE_URL                       | (Coolify instance URL)                                  | Coolify API base URL. Required. Config, not secret.                                                                   |
| infraops-mcp-server                                                                                                                                                                                      | VPS_HOST                               | 178.156.247.239 (default)                               | VPS IP address. Config, not secret.                                                                                   |
| infraops-mcp-server                                                                                                                                                                                      | VPS_PORT                               | 22 (default)                                            | SSH port. Config, not secret.                                                                                         |
| infraops-mcp-server                                                                                                                                                                                      | VPS_USER                               | root (default)                                          | SSH username. Config, not secret.                                                                                     |
| infraops-mcp-server                                                                                                                                                                                      | VPS_SSH_KEY_PATH                       | ~/.ssh/hetzner_ed25519 (default)                        | Path to SSH private key file. Config, not secret.                                                                     |
| infraops-mcp-server                                                                                                                                                                                      | BWS_COOLIFY_SECRET_ID                  | (BWS secret ID)                                         | BWS pointer for COOLIFY_API_TOKEN. Config, not secret.                                                                |
| infraops-mcp-server                                                                                                                                                                                      | BWS_HETZNER_SECRET_ID                  | (BWS secret ID)                                         | BWS pointer for HETZNER_API_TOKEN. Optional. Config, not secret.                                                      |
| infraops-mcp-server                                                                                                                                                                                      | BWS_SSH_PASSPHRASE_SECRET_ID           | (BWS secret ID)                                         | BWS pointer for VPS_SSH_PASSPHRASE. Optional. Config, not secret.                                                     |

---

## Migration Checklist

For each secret being migrated to BWS:

- [ ] Create BWS secret with descriptive name (e.g., `booking-assistant/secret-key`)
- [ ] Update Coolify env var to use BWS injection
- [ ] Verify app still works with BWS-injected value
- [ ] Rotate the credential at its source (GitHub, Google, etc.)
- [ ] Update BWS with the new rotated value
- [ ] Verify app still works with rotated value
- [ ] Remove any hardcoded values from compose files
- [ ] Update this inventory with new status (EXPOSED → IN_BWS)

---

## Consolidation Summary

| Action                        | Secrets Affected                                               | Result                      |
| ----------------------------- | -------------------------------------------------------------- | --------------------------- |
| Consolidate GitHub PATs       | GITHUB_TOKEN + GH_TOKEN → 1 PAT                                | 2 → 1                       |
| Consolidate Anthropic keys    | CLAUDE_API_KEY + ANTHROPIC_API_KEY → 1 key                     | 2 → 1                       |
| Evaluate Google OAuth sharing | 3 separate client secrets → possibly 1                         | 3 → 1 (if appropriate)      |
| Share internal API token      | LIFEOPS_INTERNAL_API_TOKEN + INTERNAL_API_TOKEN already same   | Already 1, just move to BWS |
| Keep unique                   | All SECRET_KEYs, DB passwords, auth passwords, webhook secrets | No change in count          |

**Estimated reduction:** ~41 secrets → ~29 unique BWS entries after consolidation (includes AdjustRight, lifeops-portal CI/CD, and InfraManager BWS-sourced secrets).
