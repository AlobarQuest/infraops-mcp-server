# Namecheap Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy an Nginx reverse proxy on the VPS that routes Namecheap API calls through a static IP, then update infraops-mcp-server to use it.

**Architecture:** An Nginx container (Flavor A, Dockerfile source build) proxies two paths — `/sandbox/xml.response` → `api.sandbox.namecheap.com/xml.response` and `/prod/xml.response` → `api.namecheap.com/xml.response`. Access is locked down with a bearer token stored in BWS. The infraops-mcp-server client then points at this proxy instead of Namecheap directly, and hardcodes `NAMECHEAP_CLIENT_IP=178.156.247.239` since all requests now originate from the VPS.

**Tech Stack:** Nginx, Docker, Coolify (Flavor A source build), BWS for bearer token

---

## File Structure

### New repo: `namecheap-proxy` (at `/Users/devon/Projects/namecheap-proxy`)

| File                      | Responsibility                                                                    |
| ------------------------- | --------------------------------------------------------------------------------- |
| `Dockerfile`              | Nginx container with custom config                                                |
| `nginx.conf`              | Main Nginx config: bearer token auth, reverse proxy to sandbox/prod, health check |
| `docker-compose.test.yml` | Local testing only                                                                |
| `.gitignore`              | Standard                                                                          |

### Modified files in `infraops-mcp-server` (at `/Users/devon/Projects/infraops-mcp-server`)

| File                               | Change                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------- |
| `src/services/namecheap-client.ts` | Base URLs → proxy URLs, hardcode clientIp, remove clientIp from config/env |
| `src/index.ts`                     | Update env var docs, remove NAMECHEAP_CLIENT_IP from configured check      |
| `start.sh`                         | Remove NAMECHEAP_CLIENT_IP handling, add BWS fetch for proxy bearer token  |

---

## Part 1: Create namecheap-proxy

### Task 1: Initialize the repo

**Files:**

- Create: `/Users/devon/Projects/namecheap-proxy/.gitignore`

- [ ] **Step 1: Create repo directory and init git**

```bash
mkdir -p /Users/devon/Projects/namecheap-proxy
cd /Users/devon/Projects/namecheap-proxy
git init
```

- [ ] **Step 2: Create .gitignore**

Create `/Users/devon/Projects/namecheap-proxy/.gitignore`:

```
.env
docker-compose.test.yml
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "Initial commit"
```

---

### Task 2: Write the Nginx config

**Files:**

- Create: `/Users/devon/Projects/namecheap-proxy/nginx.conf`

The Nginx config must:

1. Listen on port 8080 (standard for Coolify non-privileged containers)
2. Validate a `Bearer <token>` in the `Authorization` header on `/sandbox/` and `/prod/` paths
3. The token value comes from the `PROXY_BEARER_TOKEN` env var (injected at container start)
4. Proxy `/sandbox/xml.response` → `https://api.sandbox.namecheap.com/xml.response` (pass query string through)
5. Proxy `/prod/xml.response` → `https://api.namecheap.com/xml.response` (pass query string through)
6. Do NOT strip or modify any query parameters (especially `ClientIp`)
7. `/health` returns 200 with no auth required
8. Use `resolver 1.1.1.1 valid=30s` for upstream DNS resolution

- [ ] **Step 1: Create nginx.conf**

Create `/Users/devon/Projects/namecheap-proxy/nginx.conf`:

```nginx
worker_processes 1;
error_log /var/log/nginx/error.log warn;
pid /tmp/nginx.pid;

events {
    worker_connections 64;
}

http {
    resolver 1.1.1.1 valid=30s;

    # Temp paths for non-root operation
    client_body_temp_path /tmp/client_body;
    proxy_temp_path /tmp/proxy;
    fastcgi_temp_path /tmp/fastcgi;
    uwsgi_temp_path /tmp/uwsgi;
    scgi_temp_path /tmp/scgi;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent"';
    access_log /var/log/nginx/access.log main;

    server {
        listen 8080;

        # Health check — no auth
        location = /health {
            access_log off;
            return 200 '{"status":"ok"}';
            add_header Content-Type application/json;
        }

        # Bearer token validation for proxy paths
        location /sandbox/xml.response {
            if ($http_authorization != "Bearer ${PROXY_BEARER_TOKEN}") {
                return 401 '{"error":"unauthorized"}';
            }
            proxy_pass https://api.sandbox.namecheap.com/xml.response$is_args$args;
            proxy_ssl_server_name on;
            proxy_set_header Host api.sandbox.namecheap.com;
            proxy_set_header Accept "application/xml";
        }

        location /prod/xml.response {
            if ($http_authorization != "Bearer ${PROXY_BEARER_TOKEN}") {
                return 401 '{"error":"unauthorized"}';
            }
            proxy_pass https://api.namecheap.com/xml.response$is_args$args;
            proxy_ssl_server_name on;
            proxy_set_header Host api.namecheap.com;
            proxy_set_header Accept "application/xml";
        }

        # Deny everything else
        location / {
            return 404 '{"error":"not found"}';
        }
    }
}
```

**Key details:**

- `$is_args$args` passes the full query string (including `ClientIp`) untouched
- `proxy_ssl_server_name on` enables SNI for the upstream HTTPS connection
- `Host` header set to the real upstream so Namecheap sees the correct hostname
- Env var `PROXY_BEARER_TOKEN` is substituted at container startup via `envsubst`
- Port 8080 avoids needing root privileges

- [ ] **Step 2: Verify the config syntax locally (optional)**

```bash
# Only if nginx is installed locally
nginx -t -c /Users/devon/Projects/namecheap-proxy/nginx.conf 2>&1 || echo "Skip — test in Docker"
```

- [ ] **Step 3: Commit**

```bash
cd /Users/devon/Projects/namecheap-proxy
git add nginx.conf
git commit -m "Add Nginx config with bearer token auth and proxy routes"
```

---

### Task 3: Write the Dockerfile

**Files:**

- Create: `/Users/devon/Projects/namecheap-proxy/Dockerfile`

- [ ] **Step 1: Create Dockerfile**

Create `/Users/devon/Projects/namecheap-proxy/Dockerfile`:

```dockerfile
FROM nginx:1.27-alpine

# Remove default config
RUN rm /etc/nginx/conf.d/default.conf

# Copy our config as a template (uses envsubst for PROXY_BEARER_TOKEN)
COPY nginx.conf /etc/nginx/templates/nginx.conf.template

# nginx:alpine image runs envsubst on /etc/nginx/templates/*.template
# and outputs to /etc/nginx/conf.d/ by default.
# We need the output at /etc/nginx/nginx.conf instead.
ENV NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx
ENV NGINX_ENVSUBST_TEMPLATE_SUFFIX=.template
# CRITICAL: Only substitute PROXY_BEARER_TOKEN — without this filter,
# envsubst destroys Nginx variables like $http_authorization, $is_args, $args
ENV NGINX_ENVSUBST_FILTER=PROXY_BEARER_TOKEN

EXPOSE 8080

# Health check
HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=5s \
    CMD wget -q --spider http://127.0.0.1:8080/health || exit 1
```

**Key details:**

- The official `nginx:alpine` image has built-in `envsubst` support via its entrypoint — files in `/etc/nginx/templates/` are processed at startup
- `NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx` tells it to write the processed template to `/etc/nginx/nginx.conf` (not the default `/etc/nginx/conf.d/`)
- `NGINX_ENVSUBST_FILTER=PROXY_BEARER_TOKEN` restricts `envsubst` to only that variable — without it, Nginx variables like `$http_authorization`, `$is_args`, `$args` get clobbered with empty strings
- No custom entrypoint needed — the stock image handles everything

- [ ] **Step 2: Build and test locally**

```bash
cd /Users/devon/Projects/namecheap-proxy
docker build -t namecheap-proxy:test .
docker run --rm -d --name nc-proxy-test -p 8080:8080 -e PROXY_BEARER_TOKEN=testtoken123 namecheap-proxy:test

# Test health
curl -s http://localhost:8080/health
# Expected: {"status":"ok"}

# Test auth rejection
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/sandbox/xml.response
# Expected: 401

# Test auth acceptance (will hit real sandbox API — just check we get XML back, not 401)
curl -s -H "Authorization: Bearer testtoken123" "http://localhost:8080/sandbox/xml.response?ApiUser=test&ApiKey=test&UserName=test&ClientIp=127.0.0.1&Command=namecheap.domains.getList" | head -5
# Expected: XML response (likely an error from Namecheap about invalid credentials, but NOT a 401 from our proxy)

docker stop nc-proxy-test
```

- [ ] **Step 3: Commit**

```bash
cd /Users/devon/Projects/namecheap-proxy
git add Dockerfile
git commit -m "Add Dockerfile for Nginx proxy"
```

---

### Task 4: Create GitHub repo and push

- [ ] **Step 1: Create the repo on GitHub**

```bash
cd /Users/devon/Projects/namecheap-proxy
gh repo create alobarquest/namecheap-proxy --private --source=. --remote=origin
git push -u origin main
```

---

### Task 5: Create BWS secret for the proxy bearer token

- [ ] **Step 1: Generate a token and store it in BWS**

Generate a random 64-char bearer token and store it in BWS with the key `NAMECHEAP_PROXY_BEARER_TOKEN`.

```bash
# Generate token
TOKEN=$(openssl rand -hex 32)
echo "Generated token: $TOKEN"

# Store in BWS — use the bws CLI
# The exact command depends on BWS project/collection setup.
# May need to do this via the BWS web UI if CLI doesn't support create.
echo "Store this token in BWS as 'NAMECHEAP_PROXY_BEARER_TOKEN'"
```

**Note:** If BWS CLI doesn't support `secret create`, store it via the Bitwarden web vault. The key name must be `NAMECHEAP_PROXY_BEARER_TOKEN`.

---

### Task 6: Deploy to Coolify

This is a Flavor A app: single container, Dockerfile source build, no database.

- [ ] **Step 1: Create Coolify project**

Use `coolify_create_project` with name `namecheap-proxy`.

- [ ] **Step 2: Create application**

Use `coolify_create_application_dockerfile` with:

- Project: the newly created project UUID
- Git repo: `https://github.com/alobarquest/namecheap-proxy`
- Branch: `main`
- Dockerfile path: `Dockerfile`
- Port: `8080`
- FQDN: `https://namecheap-proxy.devonwatkins.com`

- [ ] **Step 3: Set environment variable**

Use `coolify_create_app_env` to set:

- `PROXY_BEARER_TOKEN` = (the token from BWS)
- Mark as secret/sensitive

- [ ] **Step 4: Configure health check**

Use `coolify_update_application` to set:

- Health check enabled: true
- Health check path: `/health`
- Health check host: `127.0.0.1`
- Health check port: `8080`
- Health check interval: `10`
- Health check timeout: `5`
- Health check retries: `5`
- Health check start period: `15`

- [ ] **Step 5: Deploy**

Use `coolify_deploy` to trigger initial deployment.

- [ ] **Step 6: Verify**

```bash
# Health check
curl -s https://namecheap-proxy.devonwatkins.com/health
# Expected: {"status":"ok"}

# Auth rejection
curl -s -o /dev/null -w "%{http_code}" https://namecheap-proxy.devonwatkins.com/sandbox/xml.response
# Expected: 401
```

---

## Part 2: Update infraops-mcp-server

### Task 7: Update namecheap-client.ts — base URLs and hardcoded IP

**Files:**

- Modify: `/Users/devon/Projects/infraops-mcp-server/src/services/namecheap-client.ts`

- [ ] **Step 1: Update base URLs (lines 20-21)**

Replace:

```typescript
const NAMECHEAP_SANDBOX_URL = 'https://api.sandbox.namecheap.com/xml.response';
const NAMECHEAP_PRODUCTION_URL = 'https://api.namecheap.com/xml.response';
```

With:

```typescript
const NAMECHEAP_SANDBOX_URL = 'https://namecheap-proxy.devonwatkins.com/sandbox/xml.response';
const NAMECHEAP_PRODUCTION_URL = 'https://namecheap-proxy.devonwatkins.com/prod/xml.response';
```

- [ ] **Step 2: Hardcode clientIp and add proxy auth**

In the `NamecheapConfig` interface, remove `clientIp` and add `proxyToken`:

Replace:

```typescript
interface NamecheapConfig {
  apiUser: string;
  apiKey: string;
  userName: string;
  clientIp: string;
  useSandbox: boolean;
}
```

With:

```typescript
interface NamecheapConfig {
  apiUser: string;
  apiKey: string;
  userName: string;
  useSandbox: boolean;
  proxyToken: string;
}
```

- [ ] **Step 3: Update getConfig()**

Replace:

```typescript
function getConfig(): NamecheapConfig {
  const apiUser = process.env.NAMECHEAP_API_USER;
  const apiKey = process.env.NAMECHEAP_API_KEY;
  const clientIp = process.env.NAMECHEAP_CLIENT_IP;

  if (!apiUser || !apiKey || !clientIp) {
    throw new Error(
      'Namecheap API requires NAMECHEAP_API_USER, NAMECHEAP_API_KEY, and NAMECHEAP_CLIENT_IP. ' +
        'Store credentials in BWS and set BWS_NAMECHEAP_API_USER_SECRET_ID, ' +
        'BWS_NAMECHEAP_API_KEY_SECRET_ID in your MCP config.',
    );
  }

  const useSandbox = (process.env.NAMECHEAP_USE_SANDBOX ?? 'true').toLowerCase() === 'true';

  return {
    apiUser,
    apiKey,
    userName: process.env.NAMECHEAP_USERNAME ?? apiUser,
    clientIp,
    useSandbox,
  };
}
```

With:

```typescript
const VPS_IP = '178.156.247.239';

function getConfig(): NamecheapConfig {
  const apiUser = process.env.NAMECHEAP_API_USER;
  const apiKey = process.env.NAMECHEAP_API_KEY;
  const proxyToken = process.env.NAMECHEAP_PROXY_TOKEN;

  if (!apiUser || !apiKey || !proxyToken) {
    throw new Error(
      'Namecheap API requires NAMECHEAP_API_USER, NAMECHEAP_API_KEY, and NAMECHEAP_PROXY_TOKEN. ' +
        'Store credentials in BWS.',
    );
  }

  const useSandbox = (process.env.NAMECHEAP_USE_SANDBOX ?? 'true').toLowerCase() === 'true';

  return {
    apiUser,
    apiKey,
    userName: process.env.NAMECHEAP_USERNAME ?? apiUser,
    useSandbox,
    proxyToken,
  };
}
```

- [ ] **Step 4: Add Authorization header to axios client**

Replace:

```typescript
_client = axios.create({
  baseURL,
  timeout: REQUEST_TIMEOUT,
  // Namecheap returns XML, not JSON
  headers: { Accept: 'application/xml' },
  // Don't throw on non-2xx — we parse errors from XML
  validateStatus: () => true,
});
```

With:

```typescript
_client = axios.create({
  baseURL,
  timeout: REQUEST_TIMEOUT,
  headers: {
    Accept: 'application/xml',
    Authorization: `Bearer ${_config.proxyToken}`,
  },
  // Don't throw on non-2xx — we parse errors from XML
  validateStatus: () => true,
});
```

- [ ] **Step 5: Update namecheapCommand to use hardcoded VPS_IP**

In the `namecheapCommand` function, replace:

```typescript
    ClientIp: config.clientIp,
```

With:

```typescript
    ClientIp: VPS_IP,
```

- [ ] **Step 6: Update isNamecheapConfigured()**

Replace:

```typescript
export function isNamecheapConfigured(): boolean {
  return !!(
    process.env.NAMECHEAP_API_USER &&
    process.env.NAMECHEAP_API_KEY &&
    process.env.NAMECHEAP_CLIENT_IP
  );
}
```

With:

```typescript
export function isNamecheapConfigured(): boolean {
  return !!(
    process.env.NAMECHEAP_API_USER &&
    process.env.NAMECHEAP_API_KEY &&
    process.env.NAMECHEAP_PROXY_TOKEN
  );
}
```

- [ ] **Step 7: Update handleNamecheapError IP reference**

Replace:

```typescript
if (code === 2011170)
  return `Error: Namecheap IP not whitelisted. Add ${process.env.NAMECHEAP_CLIENT_IP} to your API access list.`;
```

With:

```typescript
if (code === 2011170)
  return `Error: Namecheap IP not whitelisted. Add ${VPS_IP} to your API access list.`;
```

- [ ] **Step 8: Commit**

```bash
cd /Users/devon/Projects/infraops-mcp-server
git add src/services/namecheap-client.ts
git commit -m "Route Namecheap API calls through VPS proxy, hardcode client IP"
```

---

### Task 8: Update start.sh

**Files:**

- Modify: `/Users/devon/Projects/infraops-mcp-server/start.sh`

- [ ] **Step 1: Replace NAMECHEAP_CLIENT_IP handling with proxy token fetch**

In the Namecheap section of `start.sh`, remove the `NAMECHEAP_CLIENT_IP` warning block and add proxy token fetch.

Remove these lines (after the API key fetch block):

```bash
# NAMECHEAP_CLIENT_IP must be set explicitly — it's the IP whitelisted in your
# Namecheap API settings, which is your local machine's public IP (not the VPS).
if [ -n "${NAMECHEAP_API_USER:-}" ] && [ -n "${NAMECHEAP_API_KEY:-}" ]; then
  if [ -z "${NAMECHEAP_CLIENT_IP:-}" ]; then
    echo "WARN: NAMECHEAP_CLIENT_IP not set. Namecheap API calls will fail unless your IP is whitelisted." >&2
  fi
  echo "Namecheap tools enabled (env: ${NC_ENV_LABEL}, clientIp: ${NAMECHEAP_CLIENT_IP:-not set})" >&2
fi
```

Replace with:

```bash
# Proxy bearer token for namecheap-proxy.devonwatkins.com
export NAMECHEAP_PROXY_TOKEN=$(fetch_bws_secret_by_name "NAMECHEAP_PROXY_BEARER_TOKEN")
if [ -n "$NAMECHEAP_PROXY_TOKEN" ]; then
  echo "Namecheap proxy token loaded from BWS" >&2
fi

if [ -n "${NAMECHEAP_API_USER:-}" ] && [ -n "${NAMECHEAP_API_KEY:-}" ] && [ -n "${NAMECHEAP_PROXY_TOKEN:-}" ]; then
  echo "Namecheap tools enabled (env: ${NC_ENV_LABEL}, via VPS proxy)" >&2
fi
```

- [ ] **Step 2: Remove NAMECHEAP_CLIENT_IP from header comments**

Remove the line:

```bash
#   NAMECHEAP_CLIENT_IP         - Your machine's public IP (must be whitelisted in Namecheap)
```

- [ ] **Step 3: Commit**

```bash
cd /Users/devon/Projects/infraops-mcp-server
git add start.sh
git commit -m "Replace NAMECHEAP_CLIENT_IP with proxy token from BWS"
```

---

### Task 9: Update index.ts env var docs

**Files:**

- Modify: `/Users/devon/Projects/infraops-mcp-server/src/index.ts`

- [ ] **Step 1: Update the env var comment block**

Replace:

```typescript
 *   NAMECHEAP_API_USER          - Namecheap API username (optional, from BWS via start.sh)
 *   NAMECHEAP_API_KEY           - Namecheap API key (optional, from BWS via start.sh)
 *   NAMECHEAP_CLIENT_IP         - Your machine's public IP (must be whitelisted in Namecheap)
 *   NAMECHEAP_USE_SANDBOX       - "true" for sandbox, "false" for production (default: "true")
```

With:

```typescript
 *   NAMECHEAP_API_USER          - Namecheap API username (optional, from BWS via start.sh)
 *   NAMECHEAP_API_KEY           - Namecheap API key (optional, from BWS via start.sh)
 *   NAMECHEAP_PROXY_TOKEN       - Bearer token for namecheap-proxy (from BWS via start.sh)
 *   NAMECHEAP_USE_SANDBOX       - "true" for sandbox, "false" for production (default: "true")
```

- [ ] **Step 2: Update the "not configured" log message**

Replace:

```typescript
console.error('NAMECHEAP_API_USER/KEY/IP not set — Namecheap tools disabled');
```

With:

```typescript
console.error('NAMECHEAP_API_USER/KEY/PROXY_TOKEN not set — Namecheap tools disabled');
```

- [ ] **Step 3: Commit**

```bash
cd /Users/devon/Projects/infraops-mcp-server
git add src/index.ts
git commit -m "Update env var docs for proxy-based Namecheap access"
```

---

### Task 10: Update test-namecheap.sh

**Files:**

- Modify: `/Users/devon/Projects/infraops-mcp-server/test-namecheap.sh`

- [ ] **Step 1: Replace IP detection block with proxy token fetch**

Replace lines 42-53 (the entire IP detection section):

```bash
# ── Detect public IP ─────────────────────────────────────────────────

echo "Detecting public IP..."
export NAMECHEAP_CLIENT_IP=$(curl -s https://api.ipify.org 2>/dev/null || curl -s https://checkip.amazonaws.com 2>/dev/null || echo "")

if [ -z "$NAMECHEAP_CLIENT_IP" ]; then
  echo "ERROR: Could not detect public IP. Set NAMECHEAP_CLIENT_IP manually." >&2
  exit 1
fi

echo "  Client IP: $NAMECHEAP_CLIENT_IP"
echo ""
```

With:

```bash
# ── Proxy token ──────────────────────────────────────────────────────

echo "Fetching proxy token from BWS..."
export NAMECHEAP_PROXY_TOKEN=$(fetch_bws_secret_by_name "NAMECHEAP_PROXY_BEARER_TOKEN")

if [ -z "$NAMECHEAP_PROXY_TOKEN" ]; then
  echo "ERROR: Could not fetch NAMECHEAP_PROXY_BEARER_TOKEN from BWS." >&2
  exit 1
fi

echo "  Proxy token: loaded"
echo ""
```

- [ ] **Step 2: Commit**

```bash
cd /Users/devon/Projects/infraops-mcp-server
git add test-namecheap.sh
git commit -m "Update test script for proxy-based access"
```

---

### Task 11: Build and end-to-end test

- [ ] **Step 1: Build TypeScript**

```bash
cd /Users/devon/Projects/infraops-mcp-server
npm run build
```

Expected: Clean build, no errors.

- [ ] **Step 2: Test with sandbox**

```bash
cd /Users/devon/Projects/infraops-mcp-server
NAMECHEAP_USE_SANDBOX=true ./test-namecheap.sh
```

Expected: All 5 tests pass, requests route through the proxy.

- [ ] **Step 3: Test with production**

```bash
NAMECHEAP_USE_SANDBOX=false ./test-namecheap.sh
```

Expected: Domain listing returns real production domains.
