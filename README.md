# InfraOps MCP Server

A Model Context Protocol server for infrastructure operations. Currently provides full Coolify management, with the architecture designed for future extension to VPS (SSH), Namecheap (DNS), and Cloudflare (tunnels/DNS/WAF).

**This is the "doer" — it executes operations. For standards and policies, see the Infra Brain / infra-standards skill.**

## Tools (34 total)

### Projects & Environments
| Tool | Description |
|------|-------------|
| `coolify_list_projects` | List all projects |
| `coolify_get_project` | Get project details + environments |
| `coolify_create_project` | Create a new project |
| `coolify_update_project` | Update project name/description |
| `coolify_delete_project` | Delete project and all contents |
| `coolify_list_environments` | List environments in a project |
| `coolify_create_environment` | Create environment (production, staging, etc.) |
| `coolify_delete_environment` | Delete an environment |

### Applications
| Tool | Description |
|------|-------------|
| `coolify_list_applications` | List all applications |
| `coolify_get_application` | Full app details (build config, health checks, Git) |
| `coolify_create_application_public` | Create from public Git repo (Flavor A) |
| `coolify_create_application_dockerimage` | Create from Docker image/GHCR (Flavor B/C) |
| `coolify_create_application_dockerfile` | Create from inline Dockerfile |
| `coolify_update_application` | Update app config (domains, build, health checks) |
| `coolify_delete_application` | Delete an application |
| `coolify_application_logs` | Retrieve application logs |

### Deployments
| Tool | Description |
|------|-------------|
| `coolify_deploy` | Trigger deployment by UUID or tag |
| `coolify_list_deployments` | Deployment history for an app |
| `coolify_get_deployment` | Deployment details and logs |

### Environment Variables
| Tool | Description |
|------|-------------|
| `coolify_list_app_envs` | List env vars for an application |
| `coolify_create_app_env` | Create a single env var |
| `coolify_update_app_env` | Update an env var |
| `coolify_delete_app_env` | Delete an env var |
| `coolify_bulk_create_app_envs` | Bulk create env vars (BWS setup) |

### Databases
| Tool | Description |
|------|-------------|
| `coolify_list_databases` | List all database resources |
| `coolify_get_database` | Database details and connection info |
| `coolify_create_database` | Create database (PostgreSQL, MySQL, Redis, etc.) |
| `coolify_update_database` | Update database config |
| `coolify_delete_database` | Delete database |

### Servers
| Tool | Description |
|------|-------------|
| `coolify_list_servers` | List all registered servers |
| `coolify_get_server` | Server details (IP, connectivity) |
| `coolify_validate_server` | Test SSH + Docker prerequisites |
| `coolify_server_resources` | List all resources on a server |
| `coolify_server_domains` | Domain-to-resource mappings |

### Services
| Tool | Description |
|------|-------------|
| `coolify_list_services` | List all services |
| `coolify_get_service` | Service details |
| `coolify_create_service` | Create from docker-compose or template |
| `coolify_update_service` | Update service config |
| `coolify_delete_service` | Delete service |

### Control & Info
| Tool | Description |
|------|-------------|
| `coolify_control` | Start/stop/restart any resource |
| `coolify_version` | Get Coolify instance version |
| `coolify_overview` | Full infrastructure snapshot |

## Setup

### Environment Variables

```bash
COOLIFY_BASE_URL=https://coolify.devonwatkins.com   # Your Coolify instance
COOLIFY_API_TOKEN=your-bearer-token-here              # From Coolify UI → Settings → API Tokens
```

### Claude Code / Cowork Configuration

Add to your MCP settings:

```json
{
  "mcpServers": {
    "infraops": {
      "command": "node",
      "args": ["/path/to/infraops-mcp-server/dist/index.js"],
      "env": {
        "COOLIFY_BASE_URL": "https://coolify.devonwatkins.com",
        "COOLIFY_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

### Build

```bash
npm install
npm run build
```

## Architecture

```
infraops-mcp-server/
├── src/
│   ├── index.ts              # Entry point, server init, tool registration
│   ├── constants.ts          # Shared constants
│   ├── types.ts              # TypeScript interfaces for API responses
│   ├── schemas/
│   │   └── common.ts         # Shared Zod schemas (UUID, pagination, etc.)
│   ├── services/
│   │   └── coolify-client.ts # Coolify API HTTP client + error handling
│   └── tools/
│       ├── projects.ts       # Project & Environment CRUD
│       ├── applications.ts   # Application lifecycle
│       ├── deployments.ts    # Deploy, list, inspect deployments
│       ├── env-vars.ts       # Environment variable management
│       ├── databases.ts      # Database resource management
│       ├── servers.ts        # Server management & validation
│       ├── services.ts       # Docker Compose service management
│       └── control.ts        # Start/stop/restart + version + overview
└── dist/                     # Compiled JavaScript
```

## Extending to Other Providers

The architecture is designed for provider modules. To add VPS/Namecheap/Cloudflare:

1. Create `src/services/vps-client.ts` (or `namecheap-client.ts`, etc.)
2. Create `src/tools/vps.ts` with tools prefixed `vps_*`
3. Register in `src/index.ts`

The `coolify_*` prefix convention ensures no naming collisions when new providers are added.
