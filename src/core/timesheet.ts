import { VtigerClient } from "./client.js";
import { isWebserviceId } from "./vtiger-id.js";

/**
 * Helpers for the time-tracking / timesheet module.
 *
 * This tool was built against a vtiger install whose time module is
 * `TimeControl`, but module and field names are customizable per install.
 * Everything here is therefore driven by a {@link TimesheetConfig} that
 * defaults to the `TimeControl` layout and can be overridden via env vars
 * (see {@link timesheetConfigFromEnv}). For installs that differ wildly,
 * the generic `create_record` / `query` tools remain available.
 */

/** Field-name mapping for the timesheet module (defaults match `TimeControl`). */
export interface TimesheetFields {
  dateStart: string; // date_start
  dateEnd: string; // date_end
  timeStart: string; // time_start
  timeEnd: string; // time_end
  relatedTo: string; // related_to (-> task)
  projectId: string; // projectid (-> project); populates the "Project name" column
  description: string; // description (activity text)
  hoursType: string; // hours_type (picklist)
  totalTime: string; // totaltime (server-computed when times are given)
  owner: string; // assigned_user_id
}

export interface TimesheetConfig {
  /** Module used for time entries. Default "TimeControl". */
  module: string;
  /** Module linked from an entry (the `related_to` target). Default "ProjectTask". */
  taskModule: string;
  /** Project module. Default "Project". */
  projectModule: string;
  fields: TimesheetFields;
  /** Name field on the task module. Default "projecttaskname". */
  taskNameField: string;
  /** Project-reference field on the task module. Default "projectid". */
  taskProjectField: string;
  /** Name field on the project module. Default "projectname". */
  projectNameField: string;
}

const DEFAULTS: TimesheetConfig = {
  module: "TimeControl",
  taskModule: "ProjectTask",
  projectModule: "Project",
  fields: {
    dateStart: "date_start",
    dateEnd: "date_end",
    timeStart: "time_start",
    timeEnd: "time_end",
    relatedTo: "related_to",
    projectId: "projectid",
    description: "description",
    hoursType: "hours_type",
    totalTime: "totaltime",
    owner: "assigned_user_id",
  },
  taskNameField: "projecttaskname",
  taskProjectField: "projectid",
  projectNameField: "projectname",
};

/** Read a timesheet config from env vars, falling back to the TimeControl defaults. */
export function timesheetConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TimesheetConfig {
  const pick = (name: string, fallback: string): string => {
    const v = env[name];
    return v && v.trim() ? v.trim() : fallback;
  };
  return {
    module: pick("VTIGER_TIMESHEET_MODULE", DEFAULTS.module),
    taskModule: pick("VTIGER_TASK_MODULE", DEFAULTS.taskModule),
    projectModule: pick("VTIGER_PROJECT_MODULE", DEFAULTS.projectModule),
    fields: {
      dateStart: pick("VTIGER_TS_DATE_START_FIELD", DEFAULTS.fields.dateStart),
      dateEnd: pick("VTIGER_TS_DATE_END_FIELD", DEFAULTS.fields.dateEnd),
      timeStart: pick("VTIGER_TS_TIME_START_FIELD", DEFAULTS.fields.timeStart),
      timeEnd: pick("VTIGER_TS_TIME_END_FIELD", DEFAULTS.fields.timeEnd),
      relatedTo: pick("VTIGER_TS_RELATED_FIELD", DEFAULTS.fields.relatedTo),
      projectId: pick("VTIGER_TS_PROJECT_FIELD", DEFAULTS.fields.projectId),
      description: pick("VTIGER_TS_DESC_FIELD", DEFAULTS.fields.description),
      hoursType: pick("VTIGER_TS_HOURSTYPE_FIELD", DEFAULTS.fields.hoursType),
      totalTime: pick("VTIGER_TS_TOTAL_FIELD", DEFAULTS.fields.totalTime),
      owner: pick("VTIGER_TS_OWNER_FIELD", DEFAULTS.fields.owner),
    },
    taskNameField: pick("VTIGER_TASK_NAME_FIELD", DEFAULTS.taskNameField),
    taskProjectField: pick("VTIGER_TASK_PROJECT_FIELD", DEFAULTS.taskProjectField),
    projectNameField: pick("VTIGER_PROJECT_NAME_FIELD", DEFAULTS.projectNameField),
  };
}

/** Escape a value for safe inclusion inside a single-quoted VTQL string literal. */
export function escapeVtql(value: string): string {
  // VTQL is SQL-like; single quotes are the string delimiter. Double them to escape.
  return value.replace(/'/g, "''");
}

/** Normalise a clock time to vtiger's "HH:MM:SS" form (accepts "H:MM" or "HH:MM:SS"). */
export function normalizeTime(t: string): string {
  const s = t.trim();
  let m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(s);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}:${m[3]}`;
  m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}:00`;
  throw new Error(`Invalid time "${t}" (expected HH:MM or HH:MM:SS)`);
}

/** Convert an explicit total ("H:MM" or a number of minutes) to seconds. */
export function parseTotalToSeconds(total: string): number {
  const s = total.trim();
  const hm = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (hm) return Number(hm[1]) * 3600 + Number(hm[2]) * 60;
  if (/^\d+$/.test(s)) return Number(s) * 60; // bare number => minutes
  throw new Error(`Invalid total "${total}" (expected "H:MM" or minutes)`);
}

export interface TaskMatch {
  id: string;
  name: string;
  projectId?: string;
}

/**
 * Resolve a task reference (used for the timesheet `related_to` field).
 * Accepts either a webservice id (returned as-is) or a name to search for.
 * Returns all matches so the caller can disambiguate.
 */
export async function findTasks(
  client: VtigerClient,
  cfg: TimesheetConfig,
  taskNameOrId: string,
): Promise<TaskMatch[]> {
  const trimmed = taskNameOrId.trim();
  if (isWebserviceId(trimmed)) {
    const rec = await client.retrieve(trimmed);
    return [{ id: rec.id, name: rec[cfg.taskNameField] ?? trimmed, projectId: rec[cfg.taskProjectField] }];
  }
  const like = escapeVtql(trimmed);
  const rows = await client.query(
    `SELECT id, ${cfg.taskNameField}, ${cfg.taskProjectField} FROM ${cfg.taskModule} WHERE ${cfg.taskNameField} LIKE '%${like}%' ORDER BY ${cfg.taskNameField} LIMIT 25;`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r[cfg.taskNameField],
    projectId: r[cfg.taskProjectField],
  }));
}

export interface ResolvedTask {
  /** Set when exactly one task matched. */
  taskId?: string;
  /** The matched task's project, so the entry's "Project name" is filled in. */
  projectId?: string;
  /** Set instead of taskId when the name was ambiguous. */
  candidates?: TaskMatch[];
}

/**
 * Resolve a task reference to its id AND its parent project. Timesheet
 * entries carry both `related_to` (the task) and `projectid` (the project);
 * deriving the project here means callers never have to supply it, and the
 * "Project name" column is always populated.
 */
export async function resolveTaskAndProject(
  client: VtigerClient,
  cfg: TimesheetConfig,
  taskNameOrId: string,
): Promise<ResolvedTask> {
  const matches = await findTasks(client, cfg, taskNameOrId);
  if (matches.length === 0) {
    throw new Error(`No task found matching "${taskNameOrId}".`);
  }
  if (matches.length > 1) return { candidates: matches };
  return { taskId: matches[0].id, projectId: matches[0].projectId };
}

/** List projects the user can access (id + name). */
export async function listProjects(client: VtigerClient, cfg: TimesheetConfig): Promise<any[]> {
  return client.query(
    `SELECT id, ${cfg.projectNameField} FROM ${cfg.projectModule} ORDER BY ${cfg.projectNameField} LIMIT 100;`,
  );
}

export interface LogTimesheetInput {
  /** Date of the entry, "YYYY-MM-DD". */
  date: string;
  /** Task webservice id to link (the resolved `related_to`). Optional. */
  taskId?: string;
  /** Project webservice id. Optional. */
  projectId?: string;
  /** "HH:MM" clock start, e.g. "10:00". */
  startTime?: string;
  /** "HH:MM" clock end, e.g. "13:00". */
  endTime?: string;
  /** Explicit total ("H:MM" or minutes); only used when start/end are absent. */
  totalTime?: string;
  /** Free-text activity description. */
  activity?: string;
  /** Picklist value, e.g. "Regular Hours" or "Extra Hours". */
  hoursType?: string;
  /** Owner id; defaults to the authenticated user. */
  assignedUserId?: string;
}

/**
 * Assemble a timesheet `element` object for `client.create`, using the
 * configured field names. When start/end times are given, the server
 * computes the total itself — so we don't set the total field. An explicit
 * `totalTime` (without times) is written to the seconds-based total field.
 */
export function buildTimesheetElement(
  cfg: TimesheetConfig,
  input: LogTimesheetInput,
): Record<string, any> {
  const f = cfg.fields;
  const element: Record<string, any> = {
    [f.dateStart]: input.date,
    [f.dateEnd]: input.date,
  };
  if (input.assignedUserId) element[f.owner] = input.assignedUserId;
  if (input.taskId) element[f.relatedTo] = input.taskId;
  // Populates the "Project name" column. Auto-derived from the task when the
  // caller doesn't pass one (see resolveTaskAndProject).
  if (input.projectId) element[f.projectId] = input.projectId;
  if (input.startTime) element[f.timeStart] = normalizeTime(input.startTime);
  if (input.endTime) element[f.timeEnd] = normalizeTime(input.endTime);
  if (input.activity) element[f.description] = input.activity;
  if (input.hoursType) element[f.hoursType] = input.hoursType;

  // Only set the total when we can't rely on server computation from times.
  if (input.totalTime && !(input.startTime && input.endTime)) {
    element[f.totalTime] = parseTotalToSeconds(input.totalTime);
  }
  return element;
}

/** Map friendly update fields to the configured column names (for revise). */
export function buildTimesheetUpdate(
  cfg: TimesheetConfig,
  input: {
    date?: string;
    startTime?: string;
    endTime?: string;
    totalTime?: string;
    activity?: string;
    hoursType?: string;
  },
): Record<string, any> {
  const f = cfg.fields;
  const values: Record<string, any> = {};
  if (input.date) {
    values[f.dateStart] = input.date;
    values[f.dateEnd] = input.date;
  }
  if (input.startTime) values[f.timeStart] = normalizeTime(input.startTime);
  if (input.endTime) values[f.timeEnd] = normalizeTime(input.endTime);
  if (input.totalTime) values[f.totalTime] = parseTotalToSeconds(input.totalTime);
  if (input.activity) values[f.description] = input.activity;
  if (input.hoursType) values[f.hoursType] = input.hoursType;
  return values;
}

/** List the authenticated user's timesheet entries within a date range. */
export async function listMyTimesheets(
  client: VtigerClient,
  cfg: TimesheetConfig,
  from?: string,
  to?: string,
): Promise<any[]> {
  const f = cfg.fields;
  const clauses: string[] = [];
  const uid = client.userId;
  if (uid) clauses.push(`${f.owner} = '${uid}'`);
  if (from) clauses.push(`${f.dateStart} >= '${escapeVtql(from)}'`);
  if (to) clauses.push(`${f.dateStart} <= '${escapeVtql(to)}'`);
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  return client.query(
    `SELECT * FROM ${cfg.module}${where} ORDER BY ${f.dateStart} DESC LIMIT 100;`,
  );
}
