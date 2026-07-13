import { VtigerClient } from "./client.js";
import { isWebserviceId } from "./vtiger-id.js";

/**
 * Helpers for the daily timesheet module. The timesheet module in this
 * portal is `TimeControl` (table vtiger_timecontrol) — NOT literally
 * "Timesheet".
 *
 * The LIVE field set (verified via describe against production) is:
 *   date_start, date_end (date), time_start, time_end (time HH:MM:SS),
 *   related_to (-> ProjectTask), projectid (-> Project),
 *   description (activity text), hours_type (picklist: Regular/Extra Hours),
 *   assigned_user_id (owner, the only MANDATORY field),
 *   totaltime/total_hour/total_min (computed server-side from the times),
 *   tc_code (auto). We deliberately do NOT set the computed fields — the
 *   module's save_module() derives them and rolls the hours up onto the
 *   linked ProjectTask.
 */

export const TIMESHEET_MODULE = "TimeControl";
export const TASK_MODULE = "ProjectTask";
export const PROJECT_MODULE = "Project";

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

/** Convert an explicit total ("H:MM" or a number of hours/seconds) to seconds. */
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
 * Resolve a project task reference (used for the timesheet `related_to`
 * field). Accepts either a webservice id (returned as-is) or a name to
 * search for. Returns all matches so the caller can disambiguate.
 */
export async function findTasks(
  client: VtigerClient,
  taskNameOrId: string,
): Promise<TaskMatch[]> {
  const trimmed = taskNameOrId.trim();
  if (isWebserviceId(trimmed)) {
    const rec = await client.retrieve(trimmed);
    return [{ id: rec.id, name: rec.projecttaskname ?? trimmed, projectId: rec.projectid }];
  }
  const like = escapeVtql(trimmed);
  const rows = await client.query(
    `SELECT id, projecttaskname, projectid FROM ${TASK_MODULE} WHERE projecttaskname LIKE '%${like}%' ORDER BY projecttaskname LIMIT 25;`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.projecttaskname,
    projectId: r.projectid,
  }));
}

export interface LogTimesheetInput {
  /** Date of the entry, "YYYY-MM-DD". */
  date: string;
  /** Task webservice id to link (the resolved `related_to`). Optional. */
  taskId?: string;
  /** Project webservice id (`projectid`). Optional. */
  projectId?: string;
  /** "HH:MM" clock start, e.g. "10:00". */
  startTime?: string;
  /** "HH:MM" clock end, e.g. "13:00". */
  endTime?: string;
  /** Explicit total ("H:MM" or minutes); only used when start/end are absent. */
  totalTime?: string;
  /** Free-text activity description (maps to the `description` field). */
  activity?: string;
  /** Picklist value, e.g. "Regular Hours" or "Extra Hours". */
  hoursType?: string;
  /** Owner id; defaults to the authenticated user. */
  assignedUserId?: string;
}

/**
 * Assemble a TimeControl `element` object for `client.create`. Sets only
 * the fields the caller supplied. When start/end times are given, the
 * server computes totaltime/total_hour/total_min itself — so we leave
 * those alone. An explicit `totalTime` (without times) is written to the
 * seconds-based `totaltime` field.
 */
export function buildTimesheetElement(input: LogTimesheetInput): Record<string, any> {
  const element: Record<string, any> = {
    date_start: input.date,
    date_end: input.date,
  };
  if (input.assignedUserId) element.assigned_user_id = input.assignedUserId;
  if (input.taskId) element.related_to = input.taskId;
  if (input.projectId) element.projectid = input.projectId;
  if (input.startTime) element.time_start = normalizeTime(input.startTime);
  if (input.endTime) element.time_end = normalizeTime(input.endTime);
  if (input.activity) element.description = input.activity;
  if (input.hoursType) element.hours_type = input.hoursType;

  // Only set totaltime when we can't rely on server computation from times.
  if (input.totalTime && !(input.startTime && input.endTime)) {
    element.totaltime = parseTotalToSeconds(input.totalTime);
  }
  return element;
}

/** List the authenticated user's timesheet entries within a date range. */
export async function listMyTimesheets(
  client: VtigerClient,
  from?: string,
  to?: string,
): Promise<any[]> {
  const clauses: string[] = [];
  const uid = client.userId;
  if (uid) clauses.push(`assigned_user_id = '${uid}'`);
  if (from) clauses.push(`date_start >= '${escapeVtql(from)}'`);
  if (to) clauses.push(`date_start <= '${escapeVtql(to)}'`);
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  return client.query(
    `SELECT id, tc_code, date_start, time_start, time_end, totaltime, description, hours_type, related_to FROM ${TIMESHEET_MODULE}${where} ORDER BY date_start DESC LIMIT 100;`,
  );
}
