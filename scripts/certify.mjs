#!/usr/bin/env node
/**
 * Live cross-version certification harness.
 *
 * Exercises the full connector surface against a REAL vtiger install — auth +
 * version detection, listtypes, describe, query + pagination, and a dynamic,
 * schema-driven CRUD cycle (create -> retrieve -> revise -> delete -> verify)
 * on whichever module accepts a write. Everything is driven by the live schema,
 * so it works on any version (6.x/7.x/8.x) and any customized install.
 *
 * Usage (writes need delete rights, so set VTIGER_ALLOW_DELETE=true):
 *   VTIGER_URL=https://crm.example.com \
 *   VTIGER_USERNAME=admin \
 *   VTIGER_ACCESS_KEY=xxxx \
 *   VTIGER_ALLOW_DELETE=true \
 *   npm run certify
 *
 * Exit code is non-zero if any check fails. This is a maintainer/QA tool and is
 * not part of the published package.
 */
import { createClientFromEnv } from "../dist/core/client.js";

const missing = ["VTIGER_URL", "VTIGER_USERNAME", "VTIGER_ACCESS_KEY"].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing required env: ${missing.join(", ")}`);
  console.error("Set VTIGER_URL, VTIGER_USERNAME, VTIGER_ACCESS_KEY (and VTIGER_ALLOW_DELETE=true for write tests).");
  process.exit(2);
}
if ((process.env.VTIGER_ALLOW_DELETE ?? "").toLowerCase() !== "true") {
  console.warn("! VTIGER_ALLOW_DELETE is not 'true' — the CRUD cycle cannot clean up, so write tests are skipped.\n");
}

const c = createClientFromEnv();
const out = [];
const log = (ok, step, detail) => {
  out.push(ok);
  console.log(`[${ok ? "OK  " : "FAIL"}] ${step}${detail ? ": " + detail : ""}`);
};

const login = await c.login();
log(true, "login + version", `vtiger ${login.vtigerVersion}, API ${login.version}, user ${login.userId}`);

let types = [];
try { const t = await c.listTypes(); types = t.types || []; log(true, "listtypes", `${types.length} modules`); }
catch (e) { log(false, "listtypes", e.message); }

try { const rows = await c.query("SELECT id FROM Contacts LIMIT 3;"); log(true, "query Contacts", `${rows.length} rows`); }
catch (e) { log(false, "query Contacts", e.message); }
try { const rows = await c.queryAll("SELECT id FROM Contacts"); log(true, "queryAll Contacts (pagination)", `${rows.length} rows`); }
catch (e) { log(false, "queryAll Contacts (pagination)", e.message); }

// --- dynamic CRUD -----------------------------------------------------------
const canWrite = (process.env.VTIGER_ALLOW_DELETE ?? "").toLowerCase() === "true";

const sampleValue = (f) => {
  const t = f.type?.name;
  if (t === "owner") return c.userId;
  if (t === "picklist" || t === "multipicklist") return f.type.picklistValues?.[0]?.value ?? "";
  if (t === "double" || t === "integer" || t === "currency") return "1000";
  if (t === "email") return "cert@example.com";
  if (t === "phone") return "0000000000";
  if (t === "date") return new Date().toISOString().slice(0, 10);
  if (t === "time") return "10:00";
  if (t === "boolean") return "0";
  if (t === "url") return "https://example.com";
  return "ZZ Connector Test";
};

const refCache = new Map();
async function resolveRef(f) {
  for (const m of f.type?.refersTo || []) {
    if (refCache.has(m)) { if (refCache.get(m)) return refCache.get(m); continue; }
    try { const r = await c.query(`SELECT id FROM ${m} LIMIT 1;`); const id = r[0]?.id ?? null; refCache.set(m, id); if (id) return id; }
    catch { refCache.set(m, null); }
  }
  return undefined;
}

async function buildPayload(fields) {
  const payload = {};
  for (const f of fields.filter((f) => f.mandatory)) {
    if (f.type?.name === "reference") { const id = await resolveRef(f); if (id) payload[f.name] = id; }
    else { const v = sampleValue(f); if (v !== undefined) payload[f.name] = v; }
  }
  return payload;
}

if (canWrite) {
  const candidates = ["Vendors", "Faq", "Products", "Accounts", "Leads", "Contacts", "Assets", "Campaigns", "HelpDesk", "Project", "Documents"];
  let crudOk = false;
  for (const mod of candidates) {
    if (crudOk) break;
    if (types.length && !types.includes(mod)) continue;
    let d;
    try { d = await c.describe(mod); } catch { continue; }
    if (!d.createable) continue;
    const payload = await buildPayload(d.fields || []);
    let id;
    try { const created = await c.create(mod, payload); id = created.id; log(!!id, `create ${mod} (dynamic)`, `${id} [${Object.keys(payload).join(", ")}]`); }
    catch (e) { console.log(`  (skip ${mod}: ${e.message})`); continue; }
    if (!id) continue;
    try { const r = await c.retrieve(id); log(r.id === id, `retrieve ${mod}`, `id=${r.id}`); } catch (e) { log(false, `retrieve ${mod}`, e.message); }
    const sf = (d.fields || []).find((f) => f.mandatory && f.type?.name === "string");
    if (sf) { try { const r = await c.revise({ id, [sf.name]: "ZZRevised" }); log(r[sf.name] === "ZZRevised", `revise ${mod} (partial)`, `${sf.name}=${r[sf.name]}`); } catch (e) { log(false, `revise ${mod}`, e.message); } }
    try { await c.delete(id); log(true, `delete ${mod}`, "deleted"); } catch (e) { log(false, `delete ${mod}`, e.message); }
    try { await c.retrieve(id); log(false, `verify delete ${mod}`, "still retrievable!"); } catch { log(true, `verify delete ${mod}`, "gone (expected)"); }
    crudOk = true;
  }
  if (!crudOk) log(false, "CRUD", "no candidate module accepted a create (check server health / permissions)");
}

const fails = out.filter((x) => !x).length;
console.log(`\n${fails ? fails + " FAIL" : "ALL PASS"} / ${out.length} checks — vtiger ${login.vtigerVersion}`);
process.exit(fails ? 1 : 0);
