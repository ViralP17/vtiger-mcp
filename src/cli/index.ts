#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClientFromEnv } from "../core/client.js";
import {
  TIMESHEET_MODULE,
  PROJECT_MODULE,
  findTasks,
  buildTimesheetElement,
  listMyTimesheets,
} from "../core/timesheet.js";

/**
 * Thin CLI over the shared vtiger core client. Useful for quick testing,
 * scripting, and for developers who prefer the terminal. Reads the same
 * env vars as the MCP server; also loads a local .env if present.
 */

// --- minimal .env loader (no dependency) ---------------------------------
function loadEnv(): void {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// --- tiny arg parser ------------------------------------------------------
interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string[]>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        (flags[key] ??= []).push(next);
        i++;
      } else {
        (flags[key] ??= []).push("true");
      }
    } else {
      positionals.push(token);
    }
  }
  return { positionals, flags };
}

function flag(args: ParsedArgs, name: string): string | undefined {
  return args.flags[name]?.[0];
}

/** Turn repeated `--set field=value` into an object. */
function collectSet(args: ParsedArgs): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of args.flags["set"] ?? []) {
    const eq = pair.indexOf("=");
    if (eq === -1) throw new Error(`--set expects field=value, got "${pair}"`);
    out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return out;
}

function print(data: unknown): void {
  process.stdout.write(
    (typeof data === "string" ? data : JSON.stringify(data, null, 2)) + "\n",
  );
}

const USAGE = `vtiger — CLI for vtiger CRM

Usage:
  vtiger whoami
  vtiger modules
  vtiger describe <Module>
  vtiger query "<VTQL SELECT>"
  vtiger retrieve <id>
  vtiger create <Module> --set field=value [--set ...]
  vtiger update <id> --set field=value [--set ...]
  vtiger delete <id>                         (needs VTIGER_ALLOW_DELETE=true)

  vtiger projects
  vtiger tasks [nameFragment]
  vtiger log-timesheet [--date YYYY-MM-DD] [--task "<name or id>"]
                       [--start HH:MM] [--end HH:MM] [--total HH:MM]
                       [--activity "..."] [--type "Regular Hours"]
  vtiger my-timesheets [--from YYYY-MM-DD] [--to YYYY-MM-DD]

Credentials come from env (VTIGER_URL / VTIGER_USERNAME / VTIGER_ACCESS_KEY)
or a local .env file.`;

async function main(): Promise<void> {
  loadEnv();
  const argv = process.argv.slice(2);
  const command = argv[0];
  const args = parseArgs(argv.slice(1));

  if (!command || command === "help" || command === "--help" || command === "-h") {
    print(USAGE);
    return;
  }

  const client = createClientFromEnv();

  switch (command) {
    case "whoami": {
      await client.listTypes();
      let user: any = null;
      try {
        const rows = await client.query(
          `SELECT id, user_name, first_name, last_name, email1 FROM Users WHERE id = '${client.userId}';`,
        );
        user = rows[0] ?? null;
      } catch {
        // Non-admin users cannot query the Users module; userId alone is enough.
      }
      print({ userId: client.userId, user });
      break;
    }
    case "modules":
      print(await client.listTypes());
      break;
    case "describe": {
      const module = args.positionals[0];
      if (!module) throw new Error("Usage: vtiger describe <Module>");
      print(await client.describe(module));
      break;
    }
    case "query": {
      const vtql = args.positionals[0];
      if (!vtql) throw new Error('Usage: vtiger query "<VTQL SELECT>"');
      print(await client.query(vtql));
      break;
    }
    case "retrieve": {
      const id = args.positionals[0];
      if (!id) throw new Error("Usage: vtiger retrieve <id>");
      print(await client.retrieve(id));
      break;
    }
    case "create": {
      const module = args.positionals[0];
      if (!module) throw new Error("Usage: vtiger create <Module> --set field=value");
      print(await client.create(module, collectSet(args)));
      break;
    }
    case "update": {
      const id = args.positionals[0];
      if (!id) throw new Error("Usage: vtiger update <id> --set field=value");
      print(await client.revise({ id, ...collectSet(args) }));
      break;
    }
    case "delete": {
      const id = args.positionals[0];
      if (!id) throw new Error("Usage: vtiger delete <id>");
      print(await client.delete(id));
      break;
    }
    case "projects":
      print(
        await client.query(
          `SELECT id, projectname, projectstatus FROM ${PROJECT_MODULE} ORDER BY projectname LIMIT 100;`,
        ),
      );
      break;
    case "tasks":
      print(await findTasks(client, args.positionals[0] ?? ""));
      break;
    case "log-timesheet": {
      await client.listTypes(); // ensure login -> userId
      let taskId: string | undefined;
      const task = flag(args, "task");
      if (task) {
        const matches = await findTasks(client, task);
        if (matches.length === 0) throw new Error(`No task matches "${task}".`);
        if (matches.length > 1) {
          print({ message: `Multiple tasks match "${task}"; re-run with the exact id.`, candidates: matches });
          return;
        }
        taskId = matches[0].id;
      }
      const element = buildTimesheetElement({
        date: flag(args, "date") ?? new Date().toISOString().slice(0, 10),
        taskId,
        startTime: flag(args, "start"),
        endTime: flag(args, "end"),
        totalTime: flag(args, "total"),
        activity: flag(args, "activity"),
        hoursType: flag(args, "type"),
        assignedUserId: client.userId ?? undefined,
      });
      print(await client.create(TIMESHEET_MODULE, element));
      break;
    }
    case "my-timesheets": {
      await client.listTypes();
      print(await listMyTimesheets(client, flag(args, "from"), flag(args, "to")));
      break;
    }
    default:
      print(`Unknown command: ${command}\n\n${USAGE}`);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
