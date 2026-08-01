# Change Manager — Plan 2c: Flavor-B Deploy + Alobar ID Forward-Auth

> **For agentic workers:** Part 1 (repo artifacts) is subagent-buildable TDD-style. Part 2 (deployment runbook) is **operational** — it touches prod Coolify, Authentik, DNS, and BWS, so it is executed **interactively with Devon**, not by autonomous subagents. Steps use `- [ ]`.

**Goal:** Deploy the `change-manager` web app as a Flavor-B service on Coolify (GHCR image, Postgres, HTTPS) behind Alobar ID forward-auth, so Devon can review/approve at the live URL and the mini can reach the M2M API.

**Architecture:** GitHub Actions builds + pushes the image to GHCR, then triggers a Coolify redeploy (rule #5). Coolify runs the image against a Coolify-managed Postgres; the container entrypoint runs Alembic migrations at startup (rule #6) then uvicorn. Traefik puts Authentik forward-auth in front of the **GUI** paths only; `/api/*` stays reachable for the mini's M2M token. Authentik injects `X-authentik-email`, which the existing `current_user` dependency reads.

**Tech Stack:** Docker (python:3.12-slim, pinned), GitHub Actions, GHCR, Coolify 4.0.0-beta.473, Coolify Postgres, Traefik dynamic config, Authentik (Alobar ID).

**Specs/standards:** `docs/superpowers/specs/2026-06-14-change-manager-design.md`; infra-brain BLOCK rules #1/#2/#3/#5/#6/#211/#212 + WARN #12/#13/#237; the `sso-integration` skill (forward-auth recipe, §7).

**Decisions baked in (from infra-brain + the SSO skill):**

- **Domain: `change-mgr.alobar.net`** (the SSO skill's forward-auth convention is `<app>.alobar.net`, not `devonwatkins.com` — corrects the spec's placeholder). _Confirm with Devon before DNS._
- **M2M auth stays the simple shared bearer token** built in 2a (random secret in BWS → `M2M_TOKEN` env; the mini sends it). Not Authentik client-credentials JWT — that's a future upgrade; one internal caller doesn't need it.
- **Forward-auth protects GUI paths only; `/api/*` is M2M-only** — otherwise the mini can't sync (forward-auth expects a browser session, not a bearer token).
- No `SECRET_KEY`/OIDC session needed — forward-auth means the app only reads a trusted header.

---

# Part 1 — Repo artifacts (in `~/Projects/change-manager`)

## Task 1: Dockerfile + entrypoint + .dockerignore

**Files:** Create `Dockerfile`, `entrypoint.sh`, `.dockerignore`; `tests/test_entrypoint.py`.

- [ ] **Step 1: Write `.dockerignore`**

```
.venv/
__pycache__/
*.pyc
.git/
.pytest_cache/
*.db
tests/
docs/
```

- [ ] **Step 2: Write `entrypoint.sh`** (migrations at startup — rule #6 — then serve)

```sh
#!/bin/sh
set -e
echo "[entrypoint] running migrations..."
alembic upgrade head
echo "[entrypoint] starting uvicorn..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
```

- [ ] **Step 3: Write `Dockerfile`** (pinned base — rule #3 — non-root, port 8000)

```dockerfile
FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

# Deps first for layer caching
COPY pyproject.toml ./
RUN pip install --no-cache-dir .

# App + migrations
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini entrypoint.sh ./
RUN chmod +x entrypoint.sh && useradd -m appuser && chown -R appuser /app
USER appuser

EXPOSE 8000
ENTRYPOINT ["./entrypoint.sh"]
```

- [ ] **Step 4: Write `tests/test_entrypoint.py`** (cheap guard that the entrypoint is well-formed: runs migrations before serving, uses port 8000):

```python
from pathlib import Path


def test_entrypoint_migrates_before_serving():
    text = Path("entrypoint.sh").read_text()
    mig = text.index("alembic upgrade head")
    serve = text.index("uvicorn app.main:app")
    assert mig < serve, "migrations must run before uvicorn starts"
    assert "--port 8000" in text


def test_dockerfile_pins_base_and_runs_nonroot():
    df = Path("Dockerfile").read_text()
    assert ":latest" not in df            # rule #3
    assert "USER appuser" in df
    assert "EXPOSE 8000" in df
```

- [ ] **Step 5: Run** — `cd ~/Projects/change-manager && ./.venv/bin/python -m pytest tests/test_entrypoint.py` → 2 passed.

- [ ] **Step 6: (Optional, if Docker is available) build locally to validate the image:**

Run: `docker build -t change-manager:dev .`
Expected: builds cleanly. (Skip if Docker isn't installed locally — CI builds it anyway.)

- [ ] **Step 7: Commit**

```bash
cd ~/Projects/change-manager
git add Dockerfile entrypoint.sh .dockerignore tests/test_entrypoint.py
git commit -q -m "build: Dockerfile (pinned, non-root) + migrate-at-startup entrypoint"
```

## Task 2: GitHub Actions CI/CD (build → GHCR → Coolify redeploy)

**Files:** Create `.github/workflows/deploy.yml`.

- [ ] **Step 1: Write `.github/workflows/deploy.yml`** (test-gate → build+push to GHCR → trigger Coolify redeploy AFTER push — rule #5; pre-build off the VPS — rule #1)

```yaml
name: deploy
on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: pip install -e ".[dev]"
      - run: pytest -q

  build-and-deploy:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ghcr.io/alobarquest/change-manager:main
            ghcr.io/alobarquest/change-manager:${{ github.sha }}
      # Trigger Coolify ONLY after the push above succeeds (rule #5)
      - name: Trigger Coolify redeploy
        run: |
          curl -fsSL -X GET \
            "${{ secrets.COOLIFY_DEPLOY_WEBHOOK }}" \
            -H "Authorization: Bearer ${{ secrets.COOLIFY_DEPLOY_TOKEN }}"
```

Notes for the engineer: `COOLIFY_DEPLOY_WEBHOOK` + `COOLIFY_DEPLOY_TOKEN` are GitHub repo secrets set in Part 2 (after the Coolify app exists). The image is tagged `:main` (Coolify tracks this) + `:${sha}` (immutable audit) — never `:latest` (rule #3).

- [ ] **Step 2: Commit** (the workflow won't fully run until the secrets exist — that's fine; the `test` job runs regardless)

```bash
cd ~/Projects/change-manager
git add .github/workflows/deploy.yml
git commit -q -m "ci: GitHub Actions test → GHCR build/push → Coolify redeploy"
```

- [ ] **Step 3: Push** — `git push origin main`. Confirm the `test` job goes green in the Actions tab (the `build-and-deploy` job will run too but the redeploy step fails until the secrets/app exist — expected until Part 2).

---

# Part 2 — Deployment runbook (operational; do WITH Devon)

> These steps touch prod Coolify, Authentik, DNS, and BWS. Use the **infraops MCP** `coolify_*` tools (never curl/SSH/UI for what infraops can do — per `Projects/CLAUDE.md`), the **sso-integration skill** for the Authentik parts, and **BWS** for secrets. Follow the infra-brain BLOCK rules. Each `[ ]` is a checkpoint; confirm before moving on.

## Task 3: Postgres + secrets

- [ ] **Create the Postgres DB resource** in Coolify (prod) for the app — `coolify_create_database` (Postgres, pinned version tag — rule #3, no `:latest`). Capture its internal connection details. The app's `DATABASE_URL` will be `postgresql+psycopg://<user>:<pass>@<host>:5432/<db>` (psycopg3 driver — matches the `psycopg[binary]` dep).
- [ ] **Generate the M2M token** and store in BWS (Shared Infrastructure project), by-UUID convention:
  - `change-manager/M2M_TOKEN` — a random 48+ char secret (`openssl rand -hex 32`).
  - `change-manager/DATABASE_URL` — the connection string from above.
  - Confirm **no secret is committed** anywhere (rule #2, #591–593).

## Task 4: Create + configure the Coolify app (GHCR image)

- [ ] **Create the app** pointing at the private GHCR image `ghcr.io/alobarquest/change-manager:main`. Use `coolify_create_application_dockerimage` (single-container image app). If infraops can't create a private-image app cleanly, fall back to the Coolify UI with a **Deploy Key** git source (rule #237) — do NOT use `coolify_create_application_public` for the private repo (rule #238).
- [ ] **GHCR pull credentials:** the image is private — add a GHCR registry credential in Coolify (a GitHub PAT with `read:packages`, stored in BWS) so Coolify can pull. (Alternative: make only the GHCR _package_ public — but prefer private + creds.)
- [ ] **Set env vars** (single-container → `coolify_create_app_env` works, rule #239):
  - `DATABASE_URL` (from BWS) · `M2M_TOKEN` (from BWS)
  - (defaults are fine: `sso_user_header=x-authentik-email`, `dev_user=""` — leave unset)
- [ ] **Domain:** set the Coolify **FQDN** field to `https://change-mgr.alobar.net` (single-container uses the FQDN field, rule #213; HTTPS required, rule #212). Add the **DNS A record** `change-mgr.alobar.net → 178.156.247.239` (via `namecheap_*` or `cloudflare_*` infraops tools, depending on where the zone lives).
- [ ] **Health check:** enable, path `/api/health`, host `127.0.0.1` (rule #12), port 8000, interval 10s/timeout 5s/retries 5/start_period 15s. `/api/health` is already unauthenticated (rule #13).
- [ ] **Set up the Coolify deploy webhook:** get the app's redeploy webhook URL + token from Coolify; add them as GitHub repo secrets `COOLIFY_DEPLOY_WEBHOOK` + `COOLIFY_DEPLOY_TOKEN` (used by Task 2's workflow).

## Task 5: First deploy + verify the API

- [ ] **Trigger the first deploy** (push to main, or `coolify_deploy`). Watch the deploy logs — confirm the entrypoint ran `alembic upgrade head` (4 tables created) then uvicorn started.
- [ ] **Verify health:** the app shows healthy in Coolify; `curl https://change-mgr.alobar.net/api/health` → `{"status":"ok"}`.
- [ ] **Verify the M2M API** (before SSO is on, the GUI is open — that's why we do SSO next): `curl -H "Authorization: Bearer <M2M_TOKEN>" https://change-mgr.alobar.net/api/items` → `[]` (200); without the header → 401.

## Task 6: Alobar ID forward-auth (use the `sso-integration` skill, §7)

- [ ] **Create a Proxy Provider + Application** in Authentik for `change-mgr.alobar.net` (forward-auth single application) — sso-integration §7 Step 1. Slug `change-manager`.
- [ ] **Assign the Authentik Outpost** to the application (§7 Step 2).
- [ ] **Traefik dynamic config** (`/data/coolify/proxy/dynamic/change-manager.yaml` on the VPS, via `vps_write_file`) — the **two-router** split so the mini's API isn't blocked, plus the mandatory safety middlewares (§7 Steps 3–4):

```yaml
http:
  middlewares:
    cm-strip-authentik-headers:
      headers:
        customRequestHeaders:
          X-authentik-username: ''
          X-authentik-email: ''
          X-authentik-groups: ''
          X-authentik-uid: ''
          X-authentik-jwt: ''
    cm-forward-auth:
      forwardAuth:
        address: 'http://ak-outpost-<outpost-uuid>:9000/outpost.goauthentik.io/auth/traefik'
        trustForwardHeader: true
        authResponseHeaders:
          - X-authentik-username
          - X-authentik-email
          - X-authentik-groups
  routers:
    # GUI paths: strip spoofed headers, THEN forward-auth (browser SSO)
    change-manager-gui:
      rule: 'Host(`change-mgr.alobar.net`)'
      priority: 10
      entryPoints: [https]
      service: <coolify-service-name>
      middlewares: [cm-strip-authentik-headers, cm-forward-auth]
      tls: { certResolver: letsencrypt }
    # API paths: strip spoofed headers only — app's M2M token guards these (no forward-auth)
    change-manager-api:
      rule: 'Host(`change-mgr.alobar.net`) && PathPrefix(`/api`)'
      priority: 20 # higher priority than the GUI router so /api matches here first
      entryPoints: [https]
      service: <coolify-service-name>
      middlewares: [cm-strip-authentik-headers]
      tls: { certResolver: letsencrypt }
```

Fill `<outpost-uuid>` and `<coolify-service-name>` from Authentik + Coolify. If Coolify auto-generates a conflicting router for the FQDN, reconcile (you may set the domain via these labels and clear the Coolify FQDN routing, or disable Coolify's auto-router for this app — confirm which during execution).

- [ ] **Lock down direct access (rule §7-1):** ensure the app container does NOT publish a host port — it must be reachable only via Traefik on the internal Docker network. Verify no `ports:` host mapping.

## Task 7: End-to-end verification (the SSO checklist + the mini path)

- [ ] **GUI SSO:** visit `https://change-mgr.alobar.net/` in a browser → redirected to `id.alobar.net` login → after login, the dashboard loads and the user badge shows your email.
- [ ] **Header-spoof negative test (rule §7-2):** `curl -H "X-authentik-email: fakeadmin" https://change-mgr.alobar.net/` → must NOT be authenticated (the strip middleware removes it; you get redirected to login). If it loads as `fakeadmin`, the strip middleware is wrong — fix before proceeding.
- [ ] **Mini API still works through forward-auth split:** `curl -H "Authorization: Bearer <M2M_TOKEN>" https://change-mgr.alobar.net/api/items` → 200 (the `/api` router has no forward-auth). A browser hitting `/api/items` without the token → 401 from the app.
- [ ] **Decision flow:** sync a test escalation via `POST /api/sync` (M2M), approve it in the GUI, confirm `decided_by` = your SSO email and the event timeline shows it.
- [ ] **Onboard to app-brain** (new app, post-deploy) and note the deploy in the portfolio.

---

## Self-Review (completed by plan author)

- **Spec coverage:** Flavor-B deploy (GHCR image + CI + Coolify + Postgres + domain + HTTPS + health) — Tasks 1–5; Alobar ID SSO via forward-auth with the app reading `X-authentik-email` (already built) — Task 6; the M2M API reachable for the mini — handled by the two-router Traefik split (Task 6) + verified (Task 7).
- **Rule compliance:** pre-build off-VPS → GHCR (#1, Task 2); secrets in BWS, none committed (#2/#591–593, Tasks 3–4); pinned tags, no `:latest` (#3, Tasks 1–2); webhook after push (#5, Task 2); migrations at startup not build (#6, Task 1 entrypoint); branch `main` (#211); HTTPS FQDN (#212, Task 4); single-container FQDN field + env tools (#213/#239, Task 4); Deploy Key not public-app for private repo (#237/#238, Task 4); health on 127.0.0.1, `/api/health` unauthenticated (#12/#13, Task 4).
- **Security:** the forward-auth header-trust model is protected by the strip-spoofed-headers middleware (§7-2) + internal-only networking (§7-1), with an explicit negative test (Task 7). The `/api` router intentionally bypasses forward-auth but is guarded by the app's M2M token + header-strip.
- **Placeholders:** Part 1 is fully concrete. Part 2 carries deliberate fill-ins (`<outpost-uuid>`, `<coolify-service-name>`, the Coolify-generated webhook/credentials) that only exist once the resources are created — each is flagged at the step where it's obtained. These are operational unknowns, not plan gaps.
- **Known soft spot:** the exact Coolify-vs-Traefik router reconciliation (does Coolify's auto-router conflict with our custom dynamic-config routers?) is the one thing to settle live during Task 6 — flagged there.
