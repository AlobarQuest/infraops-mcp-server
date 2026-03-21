# Namecheap Integration — Setup & Environment Switch

## Overview

InfraOps now includes full Namecheap control: domain lifecycle management (list, register, renew, lock, contacts) and DNS record CRUD (get, add, update, delete records, manage nameservers).

The integration defaults to **sandbox mode** for safe testing, with a single env var flip to go live.

---

## Prerequisites

1. **Namecheap API access enabled** on your account
   - Log in → Profile → Tools → Namecheap API Access → enable
   - Whitelist your client IP (VPS IP: `178.156.247.239`)

2. **Sandbox account** (for testing)
   - Create at https://www.sandbox.namecheap.com
   - Sandbox has its own API credentials, separate from production

3. **BWS secrets stored** for both environments

---

## BWS Secrets Required

Store **both** sandbox and production credentials in BWS with these exact names. `start.sh` looks them up by name automatically — no env vars needed for the secrets themselves.

| BWS Secret Name | Value |
|---|---|
| `BWS_NAMECHEAP_SANDBOX_API_USER_SECRET_ID` | Your sandbox API username |
| `BWS_NAMECHEAP_SANDBOX_API_KEY_SECRET_ID` | Your sandbox API key |
| `BWS_NAMECHEAP_PROD_API_USER_SECRET_ID` | Your production API username |
| `BWS_NAMECHEAP_PROD_API_KEY_SECRET_ID` | Your production API key |

Only two env vars needed in your MCP config:
- `NAMECHEAP_CLIENT_IP` — Your machine's public IP (must be whitelisted in Namecheap API settings)
- `NAMECHEAP_USE_SANDBOX` — `"true"` (default) or `"false"` — controls which credential pair is loaded

---

## Sandbox Testing

### 1. Store credentials in BWS

Create four BWS secrets with the exact names above. Store sandbox and production API user/key values.

### 2. Configure in `.claude.json` (or your MCP config)

Only two env vars — credentials are fetched from BWS by name at startup.

```json
{
  "env": {
    "NAMECHEAP_CLIENT_IP": "<your-public-ip>",
    "NAMECHEAP_USE_SANDBOX": "true"
  }
}
```

### 3. Restart InfraOps MCP server

You should see in stderr:
```
Namecheap API user loaded from BWS (sandbox)
Namecheap API key loaded from BWS (sandbox)
Namecheap tools enabled (env: sandbox)
Namecheap tools registered (env: sandbox)
```

### 4. Verify with the environment check tool

Use `namecheap_domains_get_env` to confirm sandbox mode is active.

### 5. Run through test operations

- `namecheap_domains_list` — list sandbox domains
- `namecheap_domains_check` — check domain availability
- `namecheap_dns_get_hosts` — read DNS records for a sandbox domain
- `namecheap_dns_add_record` — add a test A record
- `namecheap_dns_delete_record` — clean up the test record

---

## Switching to Production

Since both credential sets are already in your config, switching is a single env var change.

### 1. Flip the flag

```json
"NAMECHEAP_USE_SANDBOX": "false"
```

### 2. Restart InfraOps MCP server

Verify with `namecheap_domains_get_env` — should show `"environment": "production"`.

### 4. Confirm with a read-only operation

Run `namecheap_domains_list` to see your real domains.

---

## Tools Reference

### Domain Management (11 tools)

| Tool | Description | Destructive? |
|---|---|---|
| `namecheap_domains_get_env` | Show API environment (sandbox/prod) | No |
| `namecheap_domains_list` | List all domains | No |
| `namecheap_domains_get_info` | Full domain details | No |
| `namecheap_domains_check` | Check availability | No |
| `namecheap_domains_register` | Register domain (💰 paid) | No |
| `namecheap_domains_renew` | Renew domain (💰 paid) | No |
| `namecheap_domains_reactivate` | Reactivate expired domain (💰 paid) | No |
| `namecheap_domains_get_lock` | Check registrar lock | No |
| `namecheap_domains_set_lock` | Enable/disable lock | No |
| `namecheap_domains_get_contacts` | WHOIS contact info | No |
| `namecheap_domains_get_tld_list` | Available TLDs + pricing | No |

### DNS Management (8 tools)

| Tool | Description | Destructive? |
|---|---|---|
| `namecheap_dns_get_hosts` | List all DNS records | No |
| `namecheap_dns_get_servers` | Get nameservers | No |
| `namecheap_dns_add_record` | Add record (preserves existing) | No |
| `namecheap_dns_update_record` | Update record by name+type | No |
| `namecheap_dns_delete_record` | Delete record by name+type+address | ⚠️ Yes |
| `namecheap_dns_set_hosts` | Full replace all records | ⚠️ Yes |
| `namecheap_dns_set_nameservers` | Set custom nameservers | ⚠️ Yes |
| `namecheap_dns_set_default` | Reset to Namecheap DNS | ⚠️ Yes |

---

## Architecture Notes

- **XML API**: Namecheap uses an XML API (not REST/JSON). The client (`namecheap-client.ts`) handles XML parsing via `fast-xml-parser`.
- **setHosts is full-replace**: To safely add/update/delete single records, the DNS tools always fetch-modify-push the full record set.
- **Conditional loading**: Like Hetzner, Namecheap tools only register if all three env vars are present (`NAMECHEAP_API_USER`, `NAMECHEAP_API_KEY`, `NAMECHEAP_CLIENT_IP`).
- **Environment toggle**: `NAMECHEAP_USE_SANDBOX` defaults to `"true"` so you can never accidentally hit production without explicitly opting in.
