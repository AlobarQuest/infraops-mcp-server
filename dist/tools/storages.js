import { z } from "zod";
import { coolifyGet, coolifyPost, coolifyPatch, coolifyDelete, handleCoolifyError, } from "../services/coolify-client.js";
import { UuidSchema, CoolifyInstanceSchema, CoolifyInstanceRequiredSchema } from "../schemas/common.js";
const ResourceSchema = z
    .enum(["application", "database", "service"])
    .describe("Resource type that owns the storage");
function storagesPath(resource, uuid) {
    return `/${resource}s/${uuid}/storages`;
}
export function registerStorageTools(server) {
    // ── List ─────────────────────────────────────────────────────────────
    server.registerTool("coolify_list_storages", {
        title: "List Storages",
        description: "List persistent volumes and bind mounts for an application, database, or service.",
        inputSchema: {
            resource: ResourceSchema,
            uuid: UuidSchema.describe("Resource UUID"),
            instance: CoolifyInstanceSchema,
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async ({ resource, uuid, instance }) => {
        try {
            const data = await coolifyGet(storagesPath(resource, uuid), undefined, instance);
            return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        catch (error) {
            return { isError: true, content: [{ type: "text", text: handleCoolifyError(error) }] };
        }
    });
    // ── Create ───────────────────────────────────────────────────────────
    server.registerTool("coolify_create_storage", {
        title: "Create Storage",
        description: "Add a persistent volume or bind mount to an application, database, or service.",
        inputSchema: {
            resource: ResourceSchema,
            uuid: UuidSchema.describe("Resource UUID"),
            name: z.string().min(1).describe("Storage name"),
            mount_path: z.string().min(1).describe("Container mount path (e.g. /data)"),
            host_path: z.string().optional().describe("Host bind-mount path (omit for named volume)"),
            instance: CoolifyInstanceRequiredSchema,
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, async ({ resource, uuid, name, mount_path, host_path, instance, }) => {
        try {
            const body = { name, mount_path };
            if (host_path !== undefined)
                body.host_path = host_path;
            const data = await coolifyPost(storagesPath(resource, uuid), body, instance);
            return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        catch (error) {
            return { isError: true, content: [{ type: "text", text: handleCoolifyError(error) }] };
        }
    });
    // ── Update ───────────────────────────────────────────────────────────
    server.registerTool("coolify_update_storage", {
        title: "Update Storage",
        description: "Update a storage entry (e.g. change mount path or host path).",
        inputSchema: {
            resource: ResourceSchema,
            uuid: UuidSchema.describe("Resource UUID"),
            storage_uuid: z.string().min(1).describe("Storage UUID"),
            name: z.string().optional().describe("New storage name"),
            mount_path: z.string().optional().describe("New container mount path"),
            host_path: z.string().optional().describe("New host bind-mount path"),
            instance: CoolifyInstanceRequiredSchema,
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async ({ resource, uuid, storage_uuid, name, mount_path, host_path, instance, }) => {
        try {
            const body = { uuid: storage_uuid };
            if (name !== undefined)
                body.name = name;
            if (mount_path !== undefined)
                body.mount_path = mount_path;
            if (host_path !== undefined)
                body.host_path = host_path;
            const data = await coolifyPatch(storagesPath(resource, uuid), body, instance);
            return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        catch (error) {
            return { isError: true, content: [{ type: "text", text: handleCoolifyError(error) }] };
        }
    });
    // ── Delete ───────────────────────────────────────────────────────────
    server.registerTool("coolify_delete_storage", {
        title: "Delete Storage",
        description: "Remove a storage entry from an application, database, or service.",
        inputSchema: {
            resource: ResourceSchema,
            uuid: UuidSchema.describe("Resource UUID"),
            storage_uuid: z.string().min(1).describe("Storage UUID to delete"),
            instance: CoolifyInstanceRequiredSchema,
        },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    }, async ({ resource, uuid, storage_uuid, instance, }) => {
        try {
            await coolifyDelete(`/${resource}s/${uuid}/storages/${storage_uuid}`, instance);
            return {
                content: [{ type: "text", text: `Storage ${storage_uuid} deleted from ${resource} ${uuid}.` }],
            };
        }
        catch (error) {
            return { isError: true, content: [{ type: "text", text: handleCoolifyError(error) }] };
        }
    });
}
//# sourceMappingURL=storages.js.map