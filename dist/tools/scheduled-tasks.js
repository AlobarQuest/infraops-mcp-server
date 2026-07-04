import { z } from 'zod';
import { coolifyGet, coolifyPost, coolifyPatch, coolifyDelete, handleCoolifyError, } from '../services/coolify-client.js';
import { UuidSchema, CoolifyInstanceSchema, CoolifyInstanceRequiredSchema, } from '../schemas/common.js';
const ResourceSchema = z
    .enum(['application', 'service'])
    .describe('Resource type that owns the scheduled task');
function tasksPath(resource, uuid) {
    return `/${resource}s/${uuid}/scheduled-tasks`;
}
export function registerScheduledTaskTools(server) {
    // ── List tasks ────────────────────────────────────────────────────────
    server.registerTool('coolify_list_scheduled_tasks', {
        title: 'List Scheduled Tasks',
        description: 'List all scheduled (cron) tasks for an application or service.',
        inputSchema: {
            resource: ResourceSchema,
            uuid: UuidSchema.describe('Resource UUID'),
            instance: CoolifyInstanceSchema,
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ resource, uuid, instance, }) => {
        try {
            const data = await coolifyGet(tasksPath(resource, uuid), undefined, instance);
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }
        catch (error) {
            return { isError: true, content: [{ type: 'text', text: handleCoolifyError(error) }] };
        }
    });
    // ── Create task ───────────────────────────────────────────────────────
    server.registerTool('coolify_create_scheduled_task', {
        title: 'Create Scheduled Task',
        description: 'Add a cron task to an application or service.',
        inputSchema: {
            resource: ResourceSchema,
            uuid: UuidSchema.describe('Resource UUID'),
            name: z.string().min(1).describe('Task name'),
            command: z.string().min(1).describe('Shell command to run'),
            frequency: z.string().min(1).describe("Cron expression (e.g. '0 * * * *' for hourly)"),
            container: z
                .string()
                .optional()
                .describe('Container name to run the command in (for compose apps)'),
            is_enabled: z
                .boolean()
                .default(true)
                .describe('Whether the task is active (default: true)'),
            instance: CoolifyInstanceRequiredSchema,
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async ({ resource, uuid, name, command, frequency, container, is_enabled, instance, }) => {
        try {
            const body = { name, command, frequency, is_enabled };
            if (container !== undefined)
                body.container = container;
            const data = await coolifyPost(tasksPath(resource, uuid), body, instance);
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }
        catch (error) {
            return { isError: true, content: [{ type: 'text', text: handleCoolifyError(error) }] };
        }
    });
    // ── Update task ───────────────────────────────────────────────────────
    server.registerTool('coolify_update_scheduled_task', {
        title: 'Update Scheduled Task',
        description: "Update a scheduled task's command, frequency, or enabled state.",
        inputSchema: {
            resource: ResourceSchema,
            uuid: UuidSchema.describe('Resource UUID'),
            task_uuid: z.string().min(1).describe('Scheduled task UUID'),
            name: z.string().optional().describe('New task name'),
            command: z.string().optional().describe('New shell command'),
            frequency: z.string().optional().describe('New cron expression'),
            container: z.string().optional().describe('New container name'),
            is_enabled: z.boolean().optional().describe('Enable or disable the task'),
            instance: CoolifyInstanceRequiredSchema,
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ resource, uuid, task_uuid, name, command, frequency, container, is_enabled, instance, }) => {
        try {
            const body = {};
            if (name !== undefined)
                body.name = name;
            if (command !== undefined)
                body.command = command;
            if (frequency !== undefined)
                body.frequency = frequency;
            if (container !== undefined)
                body.container = container;
            if (is_enabled !== undefined)
                body.is_enabled = is_enabled;
            const data = await coolifyPatch(`${tasksPath(resource, uuid)}/${task_uuid}`, body, instance);
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }
        catch (error) {
            return { isError: true, content: [{ type: 'text', text: handleCoolifyError(error) }] };
        }
    });
    // ── Delete task ───────────────────────────────────────────────────────
    server.registerTool('coolify_delete_scheduled_task', {
        title: 'Delete Scheduled Task',
        description: 'Remove a scheduled task from an application or service.',
        inputSchema: {
            resource: ResourceSchema,
            uuid: UuidSchema.describe('Resource UUID'),
            task_uuid: z.string().min(1).describe('Scheduled task UUID to delete'),
            instance: CoolifyInstanceRequiredSchema,
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async ({ resource, uuid, task_uuid, instance, }) => {
        try {
            await coolifyDelete(`${tasksPath(resource, uuid)}/${task_uuid}`, instance);
            return {
                content: [
                    { type: 'text', text: `Scheduled task ${task_uuid} deleted from ${resource} ${uuid}.` },
                ],
            };
        }
        catch (error) {
            return { isError: true, content: [{ type: 'text', text: handleCoolifyError(error) }] };
        }
    });
    // ── List executions ───────────────────────────────────────────────────
    server.registerTool('coolify_list_task_executions', {
        title: 'List Scheduled Task Executions',
        description: 'Retrieve execution history for a scheduled task.',
        inputSchema: {
            resource: ResourceSchema,
            uuid: UuidSchema.describe('Resource UUID'),
            task_uuid: z.string().min(1).describe('Scheduled task UUID'),
            instance: CoolifyInstanceSchema,
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ resource, uuid, task_uuid, instance, }) => {
        try {
            const data = await coolifyGet(`${tasksPath(resource, uuid)}/${task_uuid}/executions`, undefined, instance);
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }
        catch (error) {
            return { isError: true, content: [{ type: 'text', text: handleCoolifyError(error) }] };
        }
    });
}
//# sourceMappingURL=scheduled-tasks.js.map