/**
 * Service management tools for Coolify.
 *
 * Services in Coolify are Docker Compose-based multi-container workloads
 * or one-click service templates. For Devon's Flavor C apps, the
 * docker-compose.yml is deployed as a Coolify service.
 */
import { z } from "zod";
import { coolifyGet, coolifyPost, coolifyPatch, coolifyDelete, handleCoolifyError, } from "../services/coolify-client.js";
import { UuidSchema } from "../schemas/common.js";
export function registerServiceTools(server) {
    // ── List Services ────────────────────────────────────────────────
    server.registerTool("coolify_list_services", {
        title: "List Coolify Services",
        description: "List all services (Docker Compose workloads) managed by Coolify.",
        inputSchema: {},
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async () => {
        try {
            const services = await coolifyGet("/services");
            return {
                content: [
                    { type: "text", text: JSON.stringify(services, null, 2) },
                ],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: handleCoolifyError(error) }],
            };
        }
    });
    // ── Get Service ──────────────────────────────────────────────────
    server.registerTool("coolify_get_service", {
        title: "Get Coolify Service",
        description: "Get full details for a service by UUID — includes compose config, status, and resource mapping.",
        inputSchema: { uuid: UuidSchema },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ uuid }) => {
        try {
            const svc = await coolifyGet(`/services/${uuid}`);
            return {
                content: [{ type: "text", text: JSON.stringify(svc, null, 2) }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: handleCoolifyError(error) }],
            };
        }
    });
    // ── Create Service ───────────────────────────────────────────────
    server.registerTool("coolify_create_service", {
        title: "Create Coolify Service",
        description: "Create a new service from a Docker Compose definition or a one-click template. " +
            "For Devon's Flavor C apps (like Contact Hub), supply the docker-compose.yml content.",
        inputSchema: {
            project_uuid: z.string().min(1).describe("UUID of the target project"),
            environment_name: z
                .string()
                .default("production")
                .describe("Environment name"),
            server_uuid: z.string().min(1).describe("Server UUID"),
            destination_uuid: z.string().min(1).describe("Destination UUID"),
            type: z
                .string()
                .describe("Service type — use a one-click template name or 'docker-compose' for custom compose"),
            name: z.string().optional().describe("Service display name"),
            description: z.string().optional().describe("Service description"),
            docker_compose_raw: z
                .string()
                .optional()
                .describe("Raw docker-compose.yml content (required if type is docker-compose)"),
            domains: z.string().optional().describe("FQDN for the service"),
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async (params) => {
        try {
            const body = {
                project_uuid: params.project_uuid,
                environment_name: params.environment_name,
                server_uuid: params.server_uuid,
                destination_uuid: params.destination_uuid,
                type: params.type,
            };
            if (params.name)
                body.name = params.name;
            if (params.description)
                body.description = params.description;
            if (params.docker_compose_raw)
                body.docker_compose_raw = params.docker_compose_raw;
            if (params.domains)
                body.domains = params.domains;
            const svc = await coolifyPost("/services", body);
            return {
                content: [{ type: "text", text: JSON.stringify(svc, null, 2) }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: handleCoolifyError(error) }],
            };
        }
    });
    // ── Update Service ───────────────────────────────────────────────
    server.registerTool("coolify_update_service", {
        title: "Update Coolify Service",
        description: "Update a service's configuration.",
        inputSchema: {
            uuid: UuidSchema,
            name: z.string().optional().describe("New name"),
            description: z.string().optional().describe("New description"),
            docker_compose_raw: z
                .string()
                .optional()
                .describe("Updated docker-compose.yml content"),
            domains: z.string().optional().describe("New FQDN"),
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async (params) => {
        try {
            const uuid = params.uuid;
            const body = {};
            for (const field of [
                "name",
                "description",
                "docker_compose_raw",
                "domains",
            ]) {
                if (params[field] !== undefined)
                    body[field] = params[field];
            }
            const svc = await coolifyPatch(`/services/${uuid}`, body);
            return {
                content: [{ type: "text", text: JSON.stringify(svc, null, 2) }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: handleCoolifyError(error) }],
            };
        }
    });
    // ── Delete Service ───────────────────────────────────────────────
    server.registerTool("coolify_delete_service", {
        title: "Delete Coolify Service",
        description: "Delete a service. WARNING: Stops all containers and removes the service definition.",
        inputSchema: { uuid: UuidSchema },
        annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async ({ uuid }) => {
        try {
            await coolifyDelete(`/services/${uuid}`);
            return {
                content: [
                    { type: "text", text: `Service ${uuid} deleted successfully.` },
                ],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: handleCoolifyError(error) }],
            };
        }
    });
}
//# sourceMappingURL=services.js.map