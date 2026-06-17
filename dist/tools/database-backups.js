/**
 * Database backup tools for Coolify.
 *
 * Manage scheduled backup configs and inspect backup executions for a database.
 * All endpoints live under `/databases/{database_uuid}/backups`.
 */
import { z } from "zod";
import { coolifyGet, coolifyPost, coolifyPatch, coolifyDelete, handleCoolifyError, } from "../services/coolify-client.js";
import { CoolifyInstanceSchema, CoolifyInstanceRequiredSchema } from "../schemas/common.js";
import { jsonResponse } from "../utils/response.js";
// Shared optional backup-config fields (create/update share these).
const backupConfigShape = {
    enabled: z.boolean().optional().describe("Whether the schedule is active"),
    save_s3: z.boolean().optional().describe("Also upload backups to S3"),
    s3_storage_uuid: z.string().optional().describe("S3 storage UUID (required if save_s3)"),
    databases_to_backup: z
        .string()
        .optional()
        .describe("Comma-separated DB names to back up (engine-specific)"),
    dump_all: z.boolean().optional().describe("Dump all databases on the server"),
    database_backup_retention_days_locally: z.number().int().optional(),
    database_backup_retention_days_s3: z.number().int().optional(),
    database_backup_retention_amount_locally: z.number().int().optional(),
    database_backup_retention_amount_s3: z.number().int().optional(),
};
export function registerDatabaseBackupTools(server) {
    // ── List backup schedules ────────────────────────────────────────
    server.registerTool("coolify_list_database_backups", {
        title: "List Database Backup Schedules",
        description: "List configured backup schedules for a database. Returns frequency (cron), enabled state, S3 config, and retention.",
        inputSchema: {
            database_uuid: z.string().min(1).describe("Database UUID"),
            instance: CoolifyInstanceSchema,
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async ({ database_uuid, instance }) => {
        try {
            const backups = await coolifyGet(`/databases/${database_uuid}/backups`, undefined, instance);
            return jsonResponse(backups);
        }
        catch (error) {
            return { isError: true, content: [{ type: "text", text: handleCoolifyError(error) }] };
        }
    });
    // ── Get one backup schedule ──────────────────────────────────────
    server.registerTool("coolify_get_database_backup", {
        title: "Get Database Backup Schedule",
        description: "Get a single backup schedule by its UUID.",
        inputSchema: {
            database_uuid: z.string().min(1).describe("Database UUID"),
            backup_uuid: z.string().min(1).describe("Backup schedule UUID"),
            instance: CoolifyInstanceSchema,
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async ({ database_uuid, backup_uuid, instance }) => {
        try {
            const backup = await coolifyGet(`/databases/${database_uuid}/backups/${backup_uuid}`, undefined, instance);
            return jsonResponse(backup);
        }
        catch (error) {
            return { isError: true, content: [{ type: "text", text: handleCoolifyError(error) }] };
        }
    });
    // ── List backup executions ───────────────────────────────────────
    server.registerTool("coolify_list_backup_executions", {
        title: "List Backup Executions",
        description: "List execution history (runs) for a backup schedule — status, size, filename, timestamps.",
        inputSchema: {
            database_uuid: z.string().min(1).describe("Database UUID"),
            backup_uuid: z.string().min(1).describe("Backup schedule UUID"),
            instance: CoolifyInstanceSchema,
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async ({ database_uuid, backup_uuid, instance }) => {
        try {
            const execs = await coolifyGet(`/databases/${database_uuid}/backups/${backup_uuid}/executions`, undefined, instance);
            return jsonResponse(execs);
        }
        catch (error) {
            return { isError: true, content: [{ type: "text", text: handleCoolifyError(error) }] };
        }
    });
    // ── Get one backup execution ─────────────────────────────────────
    server.registerTool("coolify_get_backup_execution", {
        title: "Get Backup Execution",
        description: "Get a single backup execution by its UUID.",
        inputSchema: {
            database_uuid: z.string().min(1).describe("Database UUID"),
            backup_uuid: z.string().min(1).describe("Backup schedule UUID"),
            execution_uuid: z.string().min(1).describe("Backup execution UUID"),
            instance: CoolifyInstanceSchema,
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async ({ database_uuid, backup_uuid, execution_uuid, instance }) => {
        try {
            const exec = await coolifyGet(`/databases/${database_uuid}/backups/${backup_uuid}/executions/${execution_uuid}`, undefined, instance);
            return jsonResponse(exec);
        }
        catch (error) {
            return { isError: true, content: [{ type: "text", text: handleCoolifyError(error) }] };
        }
    });
    // ── Create backup schedule ───────────────────────────────────────
    server.registerTool("coolify_create_database_backup", {
        title: "Create Database Backup Schedule",
        description: "Create a scheduled backup for a database. `frequency` is a cron expression (e.g. '0 2 * * *').",
        inputSchema: {
            database_uuid: z.string().min(1).describe("Database UUID"),
            frequency: z.string().min(1).describe("Cron expression, e.g. '0 2 * * *'"),
            ...backupConfigShape,
            instance: CoolifyInstanceRequiredSchema,
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, async (params) => {
        try {
            const { database_uuid, instance, ...body } = params;
            const backup = await coolifyPost(`/databases/${database_uuid}/backups`, body, instance);
            return jsonResponse(backup);
        }
        catch (error) {
            return { isError: true, content: [{ type: "text", text: handleCoolifyError(error) }] };
        }
    });
    // ── Update backup schedule ───────────────────────────────────────
    server.registerTool("coolify_update_database_backup", {
        title: "Update Database Backup Schedule",
        description: "Update fields of an existing backup schedule. Only supplied fields change.",
        inputSchema: {
            database_uuid: z.string().min(1).describe("Database UUID"),
            backup_uuid: z.string().min(1).describe("Backup schedule UUID"),
            frequency: z.string().optional().describe("Cron expression"),
            ...backupConfigShape,
            instance: CoolifyInstanceRequiredSchema,
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async (params) => {
        try {
            const { database_uuid, backup_uuid, instance, ...body } = params;
            const result = await coolifyPatch(`/databases/${database_uuid}/backups/${backup_uuid}`, body, instance);
            return jsonResponse(result);
        }
        catch (error) {
            return { isError: true, content: [{ type: "text", text: handleCoolifyError(error) }] };
        }
    });
    // ── Delete backup schedule ───────────────────────────────────────
    server.registerTool("coolify_delete_database_backup", {
        title: "Delete Database Backup Schedule",
        description: "Delete a backup schedule by UUID. Does not delete already-stored backup files.",
        inputSchema: {
            database_uuid: z.string().min(1).describe("Database UUID"),
            backup_uuid: z.string().min(1).describe("Backup schedule UUID"),
            instance: CoolifyInstanceRequiredSchema,
        },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    }, async ({ database_uuid, backup_uuid, instance }) => {
        try {
            const result = await coolifyDelete(`/databases/${database_uuid}/backups/${backup_uuid}`, instance);
            return jsonResponse(result);
        }
        catch (error) {
            return { isError: true, content: [{ type: "text", text: handleCoolifyError(error) }] };
        }
    });
    // ── Delete backup execution ──────────────────────────────────────
    server.registerTool("coolify_delete_backup_execution", {
        title: "Delete Backup Execution",
        description: "Delete a single backup execution (and its stored file) by UUID.",
        inputSchema: {
            database_uuid: z.string().min(1).describe("Database UUID"),
            backup_uuid: z.string().min(1).describe("Backup schedule UUID"),
            execution_uuid: z.string().min(1).describe("Backup execution UUID"),
            instance: CoolifyInstanceRequiredSchema,
        },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    }, async ({ database_uuid, backup_uuid, execution_uuid, instance }) => {
        try {
            const result = await coolifyDelete(`/databases/${database_uuid}/backups/${backup_uuid}/executions/${execution_uuid}`, instance);
            return jsonResponse(result);
        }
        catch (error) {
            return { isError: true, content: [{ type: "text", text: handleCoolifyError(error) }] };
        }
    });
}
//# sourceMappingURL=database-backups.js.map