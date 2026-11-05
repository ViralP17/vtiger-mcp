import { VtigerClient, VtigerConfig } from "./client.js";
import { TimesheetConfig } from "./timesheet.js";

/**
 * Preflight diagnostics ("doctor") for connecting to ANY self-hosted vtiger.
 *
 * vtiger's `/webservice.php` REST API is stable across self-hosted 6.x / 7.x /
 * 8.x (open source), so the connector itself is version-agnostic. What varies
 * between installs is deployment: whether webservice.php is reachable (a common
 * .htaccess block), whether the access key is right, the CRM version, and what
 * the time-tracking module is called. This routine probes each of those and
 * returns an actionable report so a customer on any version can self-verify and
 * fix their own setup without reading code.
 */

/** vtiger major versions this connector is tested against. */
export const SUPPORTED_MAJORS = [6, 7, 8];

export interface DoctorCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  /** Actionable remedy, present when status is not "ok". */
  fix?: string;
}

export interface DoctorReport {
  /** True when no check failed (warnings are allowed). */
  ok: boolean;
  endpoint: string;
  vtigerVersion: string | null;
  apiVersion: string | null;
  /** True/false once the version is known; null if login never succeeded. */
  supported: boolean | null;
  userId: string | null;
  moduleCount: number | null;
  checks: DoctorCheck[];
}

/** Leading integer of a version string ("7.5.0" -> 7). */
function majorOf(version: string | null): number | null {
  if (!version) return null;
  const m = /^\s*(\d+)/.exec(version);
  return m ? Number(m[1]) : null;
}

function isSupported(version: string | null): boolean {
  const major = majorOf(version);
  return major != null && SUPPORTED_MAJORS.includes(major);
}

/**
 * Run the full preflight. Never throws — every failure becomes a check with a
 * fix. Stops early (and returns) as soon as a step makes later steps moot
 * (e.g. the endpoint is unreachable).
 */
export async function runDoctor(
  config: VtigerConfig,
  tsCfg: TimesheetConfig,
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const endpoint = (config.url || "").replace(/\/+$/, "") + "/webservice.php";
  let vtigerVersion: string | null = null;
  let apiVersion: string | null = null;
  let userId: string | null = null;
  let moduleCount: number | null = null;

  const finalize = (): DoctorReport => ({
    ok: !checks.some((c) => c.status === "fail"),
    endpoint,
    vtigerVersion,
    apiVersion,
    supported: vtigerVersion ? isSupported(vtigerVersion) : null,
    userId,
    moduleCount,
    checks,
  });

  // 1. Configuration present ------------------------------------------------
  const missing = [
    !config.url && "VTIGER_URL",
    !config.username && "VTIGER_USERNAME",
    !config.accessKey && "VTIGER_ACCESS_KEY",
  ].filter(Boolean) as string[];
  if (missing.length) {
    checks.push({
      name: "Configuration",
      status: "fail",
      detail: `Missing required setting(s): ${missing.join(", ")}.`,
      fix: "Set them in your MCP client env (or a local .env for the CLI). See .env.example.",
    });
    return finalize();
  }
  checks.push({ name: "Configuration", status: "ok", detail: `Endpoint: ${endpoint}` });

  // 2. Endpoint reachable (getchallenge probe) ------------------------------
  // Done as a raw fetch so we can tell "blocked / not JSON" from "auth failed".
  try {
    const probeUrl = `${endpoint}?operation=getchallenge&username=${encodeURIComponent(config.username)}`;
    const res = await fetch(probeUrl, { headers: { Accept: "application/json" } });
    const text = await res.text();
    let payload: any = null;
    try {
      payload = JSON.parse(text);
    } catch {
      /* non-JSON body handled below */
    }

    if (!payload) {
      const looksHtml = /<html|<!doctype/i.test(text);
      const blocked = res.status === 401 || res.status === 403 || looksHtml;
      checks.push({
        name: "Endpoint reachable",
        status: "fail",
        detail: `webservice.php did not return JSON (HTTP ${res.status}). First bytes: ${text
          .slice(0, 140)
          .replace(/\s+/g, " ")}`,
        fix: blocked
          ? 'webservice.php is being blocked (usually by the vtiger .htaccess PHP allow-list). Add it to the <FilesMatch> that permits PHP, e.g. <FilesMatch "index.php|webservice.php|...">, then retry. Also confirm the URL is the CRM root (no /webservice.php).'
          : "Check VTIGER_URL points at the vtiger root (no /webservice.php) and the site is reachable over HTTPS.",
      });
      return finalize();
    }

    if (payload.success !== true) {
      const code = payload?.error?.code ?? "UNKNOWN";
      checks.push({
        name: "Endpoint reachable",
        status: "fail",
        detail: `getchallenge failed: [${code}] ${payload?.error?.message ?? ""}`.trim(),
        fix: /user/i.test(String(code))
          ? "Check VTIGER_USERNAME is the exact vtiger login username."
          : "The webservice responded but rejected the challenge; verify the URL and username.",
      });
      return finalize();
    }

    checks.push({
      name: "Endpoint reachable",
      status: "ok",
      detail: "webservice.php responded to getchallenge.",
    });
  } catch (e) {
    checks.push({
      name: "Endpoint reachable",
      status: "fail",
      detail: `Cannot reach ${endpoint}: ${e instanceof Error ? e.message : String(e)}`,
      fix: "Check VTIGER_URL, DNS, the HTTPS certificate, and any firewall. The URL is the CRM base, without /webservice.php.",
    });
    return finalize();
  }

  // 3. Authentication (full login) -----------------------------------------
  const client = new VtigerClient(config);
  try {
    const login = await client.login();
    vtigerVersion = login.vtigerVersion ?? null;
    apiVersion = login.version ?? null;
    userId = login.userId ?? null;
    checks.push({
      name: "Authentication",
      status: "ok",
      detail: `Logged in as userId ${userId}.`,
    });
  } catch (e) {
    checks.push({
      name: "Authentication",
      status: "fail",
      detail: `Login failed: ${e instanceof Error ? e.message : String(e)}`,
      fix: "Use your Webservice Access Key (CRM -> My Preferences -> 'Webservice Access Key'), NOT your login password. Regenerate it there if unsure, then update VTIGER_ACCESS_KEY.",
    });
    return finalize();
  }

  // 4. Version compatibility ------------------------------------------------
  const supported = isSupported(vtigerVersion);
  checks.push({
    name: "vtiger version",
    status: supported ? "ok" : "warn",
    detail: `Detected vtiger ${vtigerVersion ?? "unknown"} (webservice API ${apiVersion ?? "?"}).`,
    fix: supported
      ? undefined
      : `Tested on self-hosted vtiger ${SUPPORTED_MAJORS.join("/")}.x (open source). This version is outside that range — the generic tools may still work; please report what does or doesn't.`,
  });

  // 5. Modules / access -----------------------------------------------------
  let moduleList: string[] = [];
  try {
    const types = await client.listTypes();
    moduleList = types.types ?? [];
    moduleCount = moduleList.length;
    checks.push({
      name: "Modules / access",
      status: "ok",
      detail: `${moduleCount} modules visible to this user.`,
    });
  } catch (e) {
    checks.push({
      name: "Modules / access",
      status: "fail",
      detail: `listtypes failed: ${e instanceof Error ? e.message : String(e)}`,
      fix: "Confirm this user's role/profile grants webservice access.",
    });
    return finalize();
  }

  // 6. Timesheet module present --------------------------------------------
  const present = moduleList.includes(tsCfg.module);
  checks.push({
    name: "Timesheet module",
    status: present ? "ok" : "warn",
    detail: present
      ? `'${tsCfg.module}' is available.`
      : `'${tsCfg.module}' was not found among your modules.`,
    fix: present
      ? undefined
      : `Set VTIGER_TIMESHEET_MODULE (plus VTIGER_TASK_MODULE / VTIGER_PROJECT_MODULE) to your install's time-tracking module, or just use the generic create_record / query tools. Run 'vtiger modules' to see the available names.`,
  });

  return finalize();
}
