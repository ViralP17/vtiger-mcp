# vtiger-mcp

**MCP server + CLI for [vtiger CRM](https://www.vtiger.com/).** Connect any
AI agent (Claude Desktop, Claude Code, Cursor, …) to your vtiger CRM to
**log timesheets** and **create / update records in any module** — in
plain English.

It talks to vtiger's built-in REST API (`/webservice.php`, available in
vtiger 6.x / 7.x). It adds **no** access rules of its own: every call runs
**as the authenticated user**, so vtiger enforces that user's role,
profile, and row-level sharing automatically. Each person uses their own
**Webservice Access Key**, so they only see and change what their account
already allows.

> New to the terminal? See **[SETUP.md](SETUP.md)** for a click-by-click,
> non-developer guide.

---

## Features

- 🔐 **Per-user auth** via each user's Webservice Access Key — row-level
  access preserved, nothing centralized.
- 🧩 **Any module**: `create`, `update`, `query`, `describe`, `retrieve`,
  `delete` — subject to the user's permissions.
- ⏱️ **Timesheet helpers** for the time-tracking module (create/list/update
  entries, resolve tasks by name).
- 🖥️ Ships as both an **MCP server** (for AI agents) and a **CLI**.
- 📦 Zero changes to your vtiger install. Node 18+, no native deps.

## Requirements

- **Node.js 18+**
- A vtiger CRM (6.x / 7.x) whose `/webservice.php` endpoint is reachable
- Your **Webservice Access Key** — in the CRM: *My Preferences →
  "Webservice Access Key"* (a 16-char string; **not** your login password)

## Install

```bash
# Global (gives you the `vtiger` CLI and the `vtiger-mcp` server binary)
npm install -g vtiger-mcp

# …or run without installing
npx vtiger-mcp        # starts the MCP server (stdio)
```

Or from source:

```bash
git clone https://github.com/ViralP17/vtiger-mcp.git
cd vtiger-mcp
npm install
npm run build
```

## Configure

Set three environment variables (via your MCP client config, or a `.env`
file for the CLI — see [.env.example](.env.example)):

| Variable | Example | Notes |
|---|---|---|
| `VTIGER_URL` | `https://yourcrmdomain.com` | Base URL, no `/webservice.php` |
| `VTIGER_USERNAME` | `your.username` | Your vtiger login |
| `VTIGER_ACCESS_KEY` | `xxxxxxxxxxxxxxxx` | Webservice Access Key |
| `VTIGER_ALLOW_DELETE` | `false` | Set `true` to allow `delete` |

## Use as an MCP server

Point your AI client at `vtiger-mcp` and pass your credentials in `env`.

**Via npx (after `npm install -g vtiger-mcp` or letting npx fetch it):**

```json
{
  "mcpServers": {
    "vtiger": {
      "command": "npx",
      "args": ["-y", "vtiger-mcp"],
      "env": {
        "VTIGER_URL": "https://yourcrmdomain.com",
        "VTIGER_USERNAME": "your.username",
        "VTIGER_ACCESS_KEY": "your-access-key",
        "VTIGER_ALLOW_DELETE": "false"
      }
    }
  }
}
```

**From a source checkout** (use `node` + the built server path):

```json
{
  "mcpServers": {
    "vtiger": {
      "command": "node",
      "args": ["/path/to/vtiger-mcp/dist/mcp/server.js"],
      "env": { "VTIGER_URL": "https://yourcrmdomain.com", "VTIGER_USERNAME": "your.username", "VTIGER_ACCESS_KEY": "your-access-key" }
    }
  }
}
```

- **Claude Desktop** config: `%APPDATA%\Claude\claude_desktop_config.json`
  (Windows) / `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
- **Cursor / Claude Code**: a `.mcp.json` with the same `mcpServers` shape

Then just ask, e.g. *"Log 3 hours to the Website Redesign task today as
regular hours"* or *"Show my timesheets this week."*

## Use as a CLI

```bash
export VTIGER_URL=https://yourcrmdomain.com
export VTIGER_USERNAME=your.username
export VTIGER_ACCESS_KEY=your-access-key   # or put these in a .env file

vtiger whoami
vtiger modules
vtiger describe TimeControl
vtiger query "SELECT tc_code, date_start, totaltime FROM TimeControl LIMIT 5;"
vtiger log-timesheet --task "Website Redesign" --start 10:00 --end 13:00 --type "Regular Hours" --activity "API work"
vtiger my-timesheets --from 2026-07-01 --to 2026-07-31
vtiger create ProjectTask --set projecttaskname="Write docs" --set projectid=<id>
vtiger update 17x1234 --set description="Revised notes"
```

## Tools exposed to the AI agent

**Any module (scoped to your access):**

| Tool | What it does |
|---|---|
| `list_modules` | Modules you can access |
| `describe_module` | Live fields of a module (names, mandatory, picklists, references) |
| `query` | Read-only VTQL `SELECT` |
| `retrieve_record` | Fetch one record by id |
| `create_record` | Create a record in any writable module |
| `update_record` | Partial update of a record |
| `delete_record` | Delete (only if `VTIGER_ALLOW_DELETE=true`) |

**Timesheet helpers (the time-tracking module):**

| Tool | What it does |
|---|---|
| `whoami` | Your vtiger user id / profile |
| `list_my_projects` | Projects you can access |
| `list_my_tasks` | Project tasks (for the `related_to` link) |
| `log_timesheet` | Add a daily entry (resolves task, defaults date/owner, computes total) |
| `list_my_timesheets` | Your entries in a date range |
| `update_timesheet` | Edit an existing entry |

## Notes & tips

- **Field names vary per install.** vtiger schemas are customizable, so
  always `describe_module` (or `vtiger describe <Module>`) first to learn
  the exact field names before creating/updating.
- **Ids** are vtiger "webservice ids" like `17x1234`
  (`<moduleId>x<recordId>`). Reference fields (owner, `related_to`,
  `projectid`) expect these ids; the timesheet helpers resolve task names
  to ids for you.
- **The timesheet module name** in this tool defaults to `TimeControl`.
  If your install uses a different module for time tracking, use the
  generic `create_record` / `query` tools, or adjust the constants in
  `src/core/timesheet.ts`.
- **Deletes are off by default.** Set `VTIGER_ALLOW_DELETE=true` only if you
  want the agent/CLI to delete records (and your account has that right).
- **Security.** Your access key is a secret — keep it in your local `.env`
  or client config only. Use HTTPS. Nothing is centralized; each user runs
  their own copy with their own key.

## License

[MIT](LICENSE) © ViralP17
