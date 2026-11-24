import { VtigerClient } from "./client.js";

/**
 * Dynamic schema adaptation (WS2).
 *
 * Everything here is driven by vtiger's live `describe` — the connector never
 * hardcodes a module's fields. That is what lets one codebase work on any
 * version (6.x/7.x/8.x) and any customized install. These helpers:
 *   - cache `describe` per client/session (it's stable within a session),
 *   - distill it into a compact {@link ModuleSchema}, keyed off the INTERNAL
 *     field name (labels are unreliable — e.g. a 7.1 describe can return the
 *     module's internal name as its label),
 *   - validate/normalize a create/update payload against it so callers get a
 *     precise, actionable error instead of an opaque server failure.
 */

export interface FieldInfo {
  name: string;
  label: string;
  mandatory: boolean;
  type: string; // vtiger field type name, e.g. "string" | "picklist" | "reference" | "owner"
  editable: boolean;
  /** Allowed values for picklist / multipicklist fields. */
  picklist?: string[];
  /** Target module(s) for reference fields. */
  refersTo?: string[];
}

export interface ModuleSchema {
  name: string;
  label: string;
  createable: boolean;
  updateable: boolean;
  deleteable: boolean;
  fields: FieldInfo[];
  byName: Map<string, FieldInfo>;
}

/** Validation is on by default; set VTIGER_SKIP_VALIDATION=true to bypass it. */
export function validationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.VTIGER_SKIP_VALIDATION ?? "false").toLowerCase() !== "true";
}

function toFieldInfo(f: any): FieldInfo {
  const type: string = f?.type?.name ?? "string";
  const info: FieldInfo = {
    name: f.name,
    label: f.label ?? f.name,
    mandatory: !!f.mandatory,
    type,
    editable: f.editable !== false,
  };
  if (type === "picklist" || type === "multipicklist") {
    info.picklist = (f.type.picklistValues ?? []).map((p: any) =>
      typeof p === "string" ? p : (p.value ?? p.label),
    );
  }
  if (type === "reference") info.refersTo = f.type.refersTo ?? [];
  return info;
}

/** Normalise a raw `describe` result into a {@link ModuleSchema}. */
export function normalizeDescribe(d: any): ModuleSchema {
  const fields: FieldInfo[] = (d.fields ?? []).map(toFieldInfo);
  return {
    name: d.name,
    label: d.label ?? d.name,
    createable: !!d.createable,
    updateable: !!d.updateable,
    deleteable: !!d.deleteable,
    fields,
    byName: new Map(fields.map((f) => [f.name, f])),
  };
}

// Per-client describe cache (schemas are stable within a session).
const cache = new WeakMap<VtigerClient, Map<string, ModuleSchema>>();

/** Get a module's schema, memoised per client. Pass refresh=true to re-fetch. */
export async function getSchema(
  client: VtigerClient,
  module: string,
  opts: { refresh?: boolean } = {},
): Promise<ModuleSchema> {
  let byModule = cache.get(client);
  if (!byModule) {
    byModule = new Map();
    cache.set(client, byModule);
  }
  if (!opts.refresh && byModule.has(module)) return byModule.get(module)!;
  const schema = normalizeDescribe(await client.describe(module));
  byModule.set(module, schema);
  return schema;
}

export interface PrepareResult {
  /** The payload to send (picklist values case-normalised to the canonical form). */
  values: Record<string, any>;
  /** Human-readable problems that should block the call. Empty = good to go. */
  issues: string[];
}

const isEmpty = (v: any): boolean => v === undefined || v === null || v === "";

/**
 * Validate and normalise an element against a module's live schema.
 *
 * - Unknown field names are rejected (likely a typo — catch it before vtiger
 *   silently drops the value).
 * - On create, every mandatory field must be present; a missing one names its
 *   type (and, for references, its target module) so the caller can supply it.
 * - Picklist values must be allowed; a case-only mismatch is corrected silently,
 *   otherwise the allowed values are listed.
 */
export function prepareElement(
  schema: ModuleSchema,
  values: Record<string, any>,
  opts: { forCreate: boolean },
): PrepareResult {
  const out: Record<string, any> = { ...values };
  const issues: string[] = [];

  for (const [key, val] of Object.entries(values)) {
    const f = schema.byName.get(key);
    if (!f) {
      issues.push(`'${key}' is not a field on ${schema.name}`);
      continue;
    }
    if (f.type === "picklist" && f.picklist && !isEmpty(val)) {
      const s = String(val);
      if (!f.picklist.includes(s)) {
        const ci = f.picklist.find((p) => p.toLowerCase() === s.toLowerCase());
        if (ci) out[key] = ci; // fix case only
        else issues.push(`'${key}' must be one of: ${f.picklist.join(", ")}`);
      }
    }
  }

  if (opts.forCreate) {
    for (const f of schema.fields) {
      if (f.mandatory && isEmpty(values[f.name])) {
        const ref = f.refersTo?.length ? ` -> ${f.refersTo.join("/")}` : "";
        issues.push(`'${f.name}' is required (${f.type}${ref})`);
      }
    }
  }

  return { values: out, issues };
}
