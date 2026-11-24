# vtiger version support

`vtiger-mcp` targets **self-hosted, open-source vtiger** and works across major
versions because it talks to vtiger's stable REST webservice (`/webservice.php`)
and **reads the live schema at runtime** — it hardcodes no module or field names.

## Compatibility matrix

| vtiger (self-hosted OSS) | Status | Certified build |
|---|---|---|
| 6.x | ✅ Supported | 6.5.0 (read + write) |
| 7.x | ✅ Supported | 7.1.0 (read + write) |
| 8.x | ✅ Supported | 8.3.0 (read + write) |
| vtiger **Cloud** (vtiger.com hosted) | ❌ Not supported | different API |

"Certified" means the full surface — auth + version detection, `listtypes`,
`describe`, `query` with pagination, and a dynamic create → retrieve → update →
delete cycle — was run against a live install of that build (see
[`scripts/certify.mjs`](../scripts/certify.mjs)).

## Why one build works on all versions

- **Stable transport.** The challenge/login handshake and the
  create/retrieve/update/revise/delete/query/describe/listtypes operations are
  the same across 6/7/8.
- **Dynamic schema.** Modules come from `listtypes`; every field (type, mandatory
  flag, picklist values, reference targets) comes from `describe`. Create/update
  are validated against that live schema, so customized layouts and custom fields
  work with no code changes.
- **Label-safe.** Resolution keys off the **internal module name**, never the
  display label — some versions' `describe` return the internal name as the label
  (e.g. `HelpDesk` whose label is `Tickets`).

## Per-version notes

- **Time-tracking module.** `TimeControl` is an add-on, not core. It is present on
  some 6.x installs but was **absent** on the 7.1.0 and 8.3.0 installs tested. The
  timesheet helpers are therefore configurable — point them at your install's
  module with `VTIGER_TIMESHEET_MODULE` (and `VTIGER_TASK_MODULE` /
  `VTIGER_PROJECT_MODULE`), or just use the generic `create_record` / `query`
  tools, which always work. See the README's timesheet configuration section.
- **Customized schemas.** Mandatory fields vary widely per install (one tested 7.x
  install made `firstname`, `phone`, `mobile`, `annualrevenue` mandatory on
  Leads). The connector reports exactly which fields a create needs.
- **vtiger Cloud.** Not supported — it uses a different API from the self-hosted
  webservice.

## Check your own install

Read-only preflight (reachability, auth, detected version, modules, timesheet):

```bash
npx -p vtiger-mcp vtiger doctor
```

Full read + write certification against your install (maintainers; needs delete
rights so it can clean up its test record):

```bash
VTIGER_URL=https://crm.example.com VTIGER_USERNAME=admin \
VTIGER_ACCESS_KEY=xxxx VTIGER_ALLOW_DELETE=true npm run certify
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `webservice.php did not return JSON (HTTP 403/HTML)` | `webservice.php` is blocked, usually by the vtiger `.htaccess` PHP allow-list. Add it to the `<FilesMatch>` that permits PHP (e.g. `<FilesMatch "index.php\|webservice.php\|...">`). |
| `INVALID_USER_CREDENTIALS` on login | Use your **Webservice Access Key** (My Preferences → "Webservice Access Key"), not your login password. Regenerate it there if unsure. |
| `Cannot create X: '<field>' is required` | A mandatory field is missing; the message names each one (references name their target module). Supply them — query the target module for a reference id. |
| `'<field>' must be one of: …` | A picklist value isn't allowed; use one of the listed values (case is auto-corrected). |
| `'<field>' is not a field on X` | Field-name typo; run `describe_module` / `vtiger describe X` for the exact names. |
| `TIMEOUT … did not respond within Nms` | Server is slow/hung; raise `VTIGER_TIMEOUT_MS` (default 30000). |
| Query returns only 100 rows | vtiger caps webservice queries at 100 rows; the connector's helpers paginate via `queryAll`. For raw `query`, add `LIMIT offset, count`. |

To bypass pre-flight write validation entirely, set `VTIGER_SKIP_VALIDATION=true`.
