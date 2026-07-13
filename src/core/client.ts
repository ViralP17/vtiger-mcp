import { createHash } from "node:crypto";

/**
 * Thin, dependency-free client for the vtiger 6.5.1 JSON REST API
 * (`<VTIGER_URL>/webservice.php`).
 *
 * It performs the native challenge/response login using each developer's
 * own "Webservice Access Key", caches the session, and transparently
 * re-authenticates when the session expires. Every call runs AS the
 * authenticated user, so vtiger enforces that user's role / profile /
 * row-level sharing automatically — this client adds no access logic of
 * its own.
 */

export interface VtigerConfig {
  /** Base URL of the portal, e.g. https://yourcrmdomain.com (no /webservice.php). */
  url: string;
  /** vtiger login username. */
  username: string;
  /** Webservice Access Key from My Preferences (NOT the login password). */
  accessKey: string;
  /** When false, delete() throws before hitting the API. Default false. */
  allowDelete?: boolean;
}

/** Shape of a successful login result from vtiger. */
interface LoginResult {
  sessionName: string;
  userId: string;
  version: string;
  vtigerVersion: string;
}

/** Error thrown for any non-success vtiger response (carries the vtiger error code). */
export class VtigerError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "VtigerError";
    this.code = code;
  }
}

/** vtiger operations that read their input from $_GET (everything else is POST). */
const GET_OPERATIONS = new Set([
  "getchallenge",
  "retrieve",
  "query",
  "describe",
  "listtypes",
  "retrieve_related",
  "getupdates",
]);

function md5(input: string): string {
  return createHash("md5").update(input).digest("hex");
}

export class VtigerClient {
  private readonly endpoint: string;
  private readonly config: VtigerConfig;
  private session: LoginResult | null = null;

  constructor(config: VtigerConfig) {
    if (!config.url) throw new Error("VTIGER_URL is required");
    if (!config.username) throw new Error("VTIGER_USERNAME is required");
    if (!config.accessKey) throw new Error("VTIGER_ACCESS_KEY is required");
    this.config = config;
    this.endpoint = config.url.replace(/\/+$/, "") + "/webservice.php";
  }

  /** The vtiger user id of the authenticated developer (e.g. "19x5"). Requires a prior login. */
  get userId(): string | null {
    return this.session?.userId ?? null;
  }

  // ---------------------------------------------------------------------------
  // Low-level transport
  // ---------------------------------------------------------------------------

  /** Perform one HTTP call to webservice.php and unwrap the {success, result|error} envelope. */
  private async raw(
    operation: string,
    params: Record<string, string>,
  ): Promise<any> {
    const method = GET_OPERATIONS.has(operation) ? "GET" : "POST";
    const query = new URLSearchParams({ operation, ...params });

    let response: Response;
    if (method === "GET") {
      response = await fetch(`${this.endpoint}?${query.toString()}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
    } else {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: query.toString(),
      });
    }

    const text = await response.text();
    let payload: any;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new VtigerError(
        "NON_JSON_RESPONSE",
        `Expected JSON from webservice.php but got (HTTP ${response.status}): ${text.slice(0, 300)}`,
      );
    }

    if (payload && payload.success === true) return payload.result;

    const err = payload?.error ?? {};
    throw new VtigerError(err.code ?? "UNKNOWN_ERROR", err.message ?? "Unknown error");
  }

  private isSessionError(err: unknown): boolean {
    if (!(err instanceof VtigerError)) return false;
    const code = err.code.toUpperCase();
    return (
      code.includes("SESSION") ||
      code === "AUTHENTICATION_REQUIRED" ||
      code === "AUTHREQUIRED"
    );
  }

  // ---------------------------------------------------------------------------
  // Authentication
  // ---------------------------------------------------------------------------

  /** Run the challenge/response handshake and cache the session. */
  async login(): Promise<LoginResult> {
    const challenge = await this.raw("getchallenge", {
      username: this.config.username,
    });
    const token: string = challenge.token;
    const accessKey = md5(token + this.config.accessKey);

    const result: LoginResult = await this.raw("login", {
      username: this.config.username,
      accessKey,
    });
    this.session = result;
    return result;
  }

  /** Ensure we have a live session (login lazily). */
  private async ensureSession(): Promise<LoginResult> {
    if (!this.session) await this.login();
    return this.session!;
  }

  /**
   * Authenticated request with one automatic re-login + retry if the
   * session has expired. `operation` selects GET vs POST automatically.
   */
  private async call(
    operation: string,
    params: Record<string, string> = {},
  ): Promise<any> {
    const session = await this.ensureSession();
    try {
      return await this.raw(operation, { sessionName: session.sessionName, ...params });
    } catch (err) {
      if (this.isSessionError(err)) {
        const fresh = await this.login();
        return await this.raw(operation, { sessionName: fresh.sessionName, ...params });
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Typed operation wrappers
  // ---------------------------------------------------------------------------

  /** Modules the current user may access. */
  async listTypes(): Promise<{ types: string[]; information?: Record<string, any> }> {
    return this.call("listtypes");
  }

  /** Field metadata for a module (reflects the LIVE schema, incl. custom fields). */
  async describe(elementType: string): Promise<any> {
    return this.call("describe", { elementType });
  }

  /** Run a read-only VTQL SELECT. Returns an array of records. */
  async query(vtql: string): Promise<any[]> {
    return this.call("query", { query: vtql });
  }

  /** Fetch one record by its webservice id (e.g. "17x1234"). */
  async retrieve(id: string): Promise<any> {
    return this.call("retrieve", { id });
  }

  /** Create a record. `element` is a plain object of field => value. */
  async create(elementType: string, element: Record<string, any>): Promise<any> {
    return this.call("create", {
      elementType,
      element: JSON.stringify(element),
    });
  }

  /** Full-record update (must include `id` and all mandatory fields). */
  async update(element: Record<string, any>): Promise<any> {
    return this.call("update", { element: JSON.stringify(element) });
  }

  /** Partial update — only the supplied fields change (must include `id`). */
  async revise(element: Record<string, any>): Promise<any> {
    return this.call("revise", { element: JSON.stringify(element) });
  }

  /** Delete a record by webservice id. Guarded by allowDelete. */
  async delete(id: string): Promise<any> {
    if (!this.config.allowDelete) {
      throw new VtigerError(
        "DELETE_DISABLED",
        "Deletion is disabled. Set VTIGER_ALLOW_DELETE=true to enable it.",
      );
    }
    return this.call("delete", { id });
  }
}

/** Build a client from the standard environment variables. */
export function createClientFromEnv(): VtigerClient {
  return new VtigerClient({
    url: process.env.VTIGER_URL ?? "",
    username: process.env.VTIGER_USERNAME ?? "",
    accessKey: process.env.VTIGER_ACCESS_KEY ?? "",
    allowDelete: (process.env.VTIGER_ALLOW_DELETE ?? "false").toLowerCase() === "true",
  });
}
