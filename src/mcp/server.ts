#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z, ZodRawShape } from "zod";
import { createClientFromEnv, VtigerClient } from "../core/client.js";
import {
  TIMESHEET_MODULE,
  PROJECT_MODULE,
  TASK_MODULE,
  findTasks,
  buildTimesheetElement,
  listMyTimesheets,
} from "../core/timesheet.js";

/**
 * MCP stdio server that exposes the vtiger portal to an AI agent AS the
 * configured developer. Credentials come from env (VTIGER_URL /
 * VTIGER_USERNAME / VTIGER_ACCESS_KEY); vtiger enforces that developer's
 * own row-level access, so every tool is inherently scoped to them.
 */

// Lazily build the client so a missing-credential error surfaces as a clean
// tool error rather than crashing the transport at startup.
let cached: VtigerClient | null = null;
function getClient(): VtigerClient {
  if (!cached) cached = createClientFromEnv();
  return cached;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}

function fail(err: unknown): ToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

const server = new McpServer({ name: "vtiger-mcp", version: "0.1.0" });

/**
 * Register a tool with uniform error handling. `server.tool` is cast to
 * sidestep the SDK's heavily-overloaded typings; the runtime contract
 * (name, description, zod shape, async handler -> {content,...}) is exact.
 */
function tool<S extends ZodRawShape>(
  name: string,
  description: string,
  shape: S,
  handler: (args: z.objectOutputType<S, z.ZodTypeAny>) => Promise<ToolResult>,
): void {
  (server.tool as any)(name, description, shape, async (args: any) => {
    try {
      return await handler(args);
    } catch (err) {
      return fail(err);
    }
  });
}

// ---------------------------------------------------------------------------
// Generic, any-module tools (subject to the developer's own permissions)
// ---------------------------------------------------------------------------

tool(
  "list_modules",
  "List the vtiger modules (entity types) the authenticated developer is allowed to access.",
  {},
  async () => ok(await getClient().listTypes()),
);

tool(
  "describe_module",
  "Describe a module's live fields: names, labels, mandatory flags, types, picklist values and reference targets. Call this before create/update to learn the exact field names (the schema is customized).",
  { module: z.string().describe("Module name, e.g. 'TimeControl', 'ProjectTask', 'Contacts'.") },
  async ({ module }) => ok(await getClient().describe(module)),
);

tool(
  "query",
  "Run a read-only VTQL SELECT (SQL-like). Results are already filtered to what the developer may see. Example: SELECT tc_code, date_start, totaltime FROM TimeControl LIMIT 10;",
  { vtql: z.string().describe("A VTQL SELECT statement. Include a LIMIT. Must start with SELECT.") },
  async ({ vtql }) => {
    if (!/^\s*select\b/i.test(vtql)) {
      throw new Error("Only read-only SELECT queries are allowed here. Use create/update tools to modify data.");
    }
    return ok(await getClient().query(vtql));
  },
);

tool(
  "retrieve_record",
  "Fetch one record by its vtiger webservice id (e.g. '17x1234').",
  { id: z.string().describe("Webservice id, format <moduleId>x<recordId>.") },
  async ({ id }) => ok(await getClient().retrieve(id)),
);

tool(
  "create_record",
  "Create a record in any module the developer can write to. Provide field values as an object; use describe_module first to get exact field names. Reference fields (owners, related records) take webservice ids.",
  {
    module: z.string().describe("Target module name, e.g. 'ProjectTask'."),
    values: z.record(z.any()).describe("Field name -> value map for the new record."),
  },
  async ({ module, values }) => ok(await getClient().create(module, values)),
);

tool(
  "update_record",
  "Update fields on an existing record (partial update — only supplied fields change). Uses vtiger 'revise'.",
  {
    id: z.string().describe("Webservice id of the record to update."),
    values: z.record(z.any()).describe("Field name -> new value map."),
  },
  async ({ id, values }) => ok(await getClient().revise({ id, ...values })),
);

tool(
  "delete_record",
  "Delete a record by webservice id. Disabled unless the server was started with VTIGER_ALLOW_DELETE=true.",
  { id: z.string().describe("Webservice id of the record to delete.") },
  async ({ id }) => ok(await getClient().delete(id)),
);

// ---------------------------------------------------------------------------
// Timesheet convenience tools (TimeControl module)
// ---------------------------------------------------------------------------

tool(
  "whoami",
  "Return the authenticated developer's vtiger user id and profile info.",
  {},
  async () => {
    const client = getClient();
    await client.listTypes(); // forces login so userId is populated
    let user: any = null;
    try {
      const rows = await client.query(
        `SELECT id, user_name, first_name, last_name, email1 FROM Users WHERE id = '${client.userId}';`,
      );
      user = rows[0] ?? null;
    } catch {
      // Non-admin users cannot query the Users module; the userId alone is enough.
    }
    return ok({ userId: client.userId, user });
  },
);

tool(
  "list_my_projects",
  "List projects the developer can access (id + name), to pick a project for timesheet logging.",
  {},
  async () =>
    ok(
      await getClient().query(
        `SELECT id, projectname, projectstatus FROM ${PROJECT_MODULE} ORDER BY projectname LIMIT 100;`,
      ),
    ),
);

tool(
  "list_my_tasks",
  "List project tasks (id + name) the developer can access. Optionally filter by a project-task name fragment. The task id is what a timesheet's 'related_to' links to.",
  { nameContains: z.string().optional().describe("Optional substring to match against the task name.") },
  async ({ nameContains }) => ok(await findTasks(getClient(), nameContains ?? "")),
);

tool(
  "log_timesheet",
  "Log a daily timesheet entry in the TimeControl module for the developer. Resolves a task by name or id, defaults the date to today and the owner to the current user, and computes total time from start/end when not given.",
  {
    date: z.string().optional().describe("Entry date YYYY-MM-DD. Defaults to today."),
    task: z.string().optional().describe("Project task name (searched) or webservice id, linked as related_to."),
    startTime: z.string().optional().describe("Clock start HH:MM, e.g. '10:00'."),
    endTime: z.string().optional().describe("Clock end HH:MM, e.g. '13:00'."),
    totalTime: z.string().optional().describe("Explicit total HH:MM; computed from start/end if omitted."),
    activity: z.string().optional().describe("Free-text description of the work."),
    hoursType: z.string().optional().describe("Picklist value, e.g. 'Regular Hours' or 'Extra Hours'."),
  },
  async (args) => {
    const client = getClient();
    await client.listTypes(); // ensure login -> userId available

    let taskId: string | undefined;
    if (args.task) {
      const matches = await findTasks(client, args.task);
      if (matches.length === 0) {
        throw new Error(`No project task found matching "${args.task}". Use list_my_tasks to browse.`);
      }
      if (matches.length > 1) {
        return ok({
          needsDisambiguation: true,
          message: `Multiple tasks match "${args.task}". Re-call log_timesheet with the exact task id.`,
          candidates: matches,
        });
      }
      taskId = matches[0].id;
    }

    const element = buildTimesheetElement({
      date: args.date ?? today(),
      taskId,
      startTime: args.startTime,
      endTime: args.endTime,
      totalTime: args.totalTime,
      activity: args.activity,
      hoursType: args.hoursType,
      assignedUserId: client.userId ?? undefined,
    });
    const created = await client.create(TIMESHEET_MODULE, element);
    return ok({ created });
  },
);

tool(
  "list_my_timesheets",
  "List the developer's own timesheet entries, optionally within a date range (YYYY-MM-DD).",
  {
    from: z.string().optional().describe("Start date inclusive, YYYY-MM-DD."),
    to: z.string().optional().describe("End date inclusive, YYYY-MM-DD."),
  },
  async ({ from, to }) => {
    const client = getClient();
    await client.listTypes(); // ensure login -> userId available
    return ok(await listMyTimesheets(client, from, to));
  },
);

tool(
  "update_timesheet",
  "Update fields on an existing TimeControl timesheet entry (partial update).",
  {
    id: z.string().describe("Webservice id of the TimeControl record."),
    date: z.string().optional().describe("New date YYYY-MM-DD."),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    totalTime: z.string().optional(),
    activity: z.string().optional(),
    hoursType: z.string().optional(),
  },
  async ({ id, date, startTime, endTime, totalTime, activity, hoursType }) => {
    const values: Record<string, any> = {};
    if (date) {
      values.date_start = date;
      values.date_end = date;
    }
    if (startTime) values.time_start = startTime;
    if (endTime) values.time_end = endTime;
    if (totalTime) values.totaltime = totalTime;
    if (activity) values.description = activity;
    if (hoursType) values.hours_type = hoursType;
    return ok(await getClient().revise({ id, ...values }));
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe for logs; stdout is the MCP channel.
  process.stderr.write("vtiger-mcp server ready (stdio)\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
