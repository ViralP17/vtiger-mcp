# Connecting vtiger-mcp to your MCP client

vtiger-mcp is a standard **stdio MCP server**, so it works with *any*
MCP-compatible client. Most clients use the same JSON block — only the
**file location** (or add command) differs.

**The common block** (works in Claude Desktop, Claude Code, Cursor,
Windsurf, Antigravity, Gemini CLI, and more):

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

Get your **Webservice Access Key** from the CRM: *My Preferences →
"Webservice Access Key"* (not your login password).

> **Windows note:** if a GUI app can't find `npx`, either install globally
> (`npm i -g vtiger-mcp`) and use `"command": "vtiger-mcp"`, or use
> `"command": "node"` with the absolute path to the installed server, e.g.
> `["C:\\Users\\you\\AppData\\Roaming\\npm\\node_modules\\vtiger-mcp\\dist\\mcp\\server.js"]`.

---

## Claude Desktop

Config file:
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

Paste the common block, then **fully quit and reopen** Claude Desktop.
Windows one-click alternative: run [`setup.ps1`](setup.ps1) (see
[SETUP.md](SETUP.md)).

## Claude Code

Add it in one command:

```bash
claude mcp add vtiger \
  --env VTIGER_URL=https://yourcrmdomain.com \
  --env VTIGER_USERNAME=your.username \
  --env VTIGER_ACCESS_KEY=your-access-key \
  -- npx -y vtiger-mcp
```

…or add the common block to a project `.mcp.json`.

## Cursor

Config file: `.cursor/mcp.json` (per-project) or `~/.cursor/mcp.json`
(global). Paste the common block, then enable **vtiger** in
*Settings → MCP*.

## Windsurf (Codeium)

Config file: `~/.codeium/windsurf/mcp_config.json`. Paste the common block
and refresh MCP servers in the Cascade panel.

## Google Antigravity

Open **Settings → MCP / Agent tools → Add MCP server** and paste the common
block (Antigravity uses the same `mcpServers` shape). If you prefer a file,
use its `mcp_config.json` with the same content. Reload the MCP servers
after saving.

## VS Code (GitHub Copilot — Agent mode)

Config file: `.vscode/mcp.json` (workspace). VS Code uses a top-level
`servers` key and a `type`:

```json
{
  "servers": {
    "vtiger": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "vtiger-mcp"],
      "env": {
        "VTIGER_URL": "https://yourcrmdomain.com",
        "VTIGER_USERNAME": "your.username",
        "VTIGER_ACCESS_KEY": "your-access-key"
      }
    }
  }
}
```

Then open the Chat view in **Agent** mode and start the `vtiger` server.

## OpenAI Codex CLI

Config file: `~/.codex/config.toml` (TOML):

```toml
[mcp_servers.vtiger]
command = "npx"
args = ["-y", "vtiger-mcp"]
env = { VTIGER_URL = "https://yourcrmdomain.com", VTIGER_USERNAME = "your.username", VTIGER_ACCESS_KEY = "your-access-key", VTIGER_ALLOW_DELETE = "false" }
```

## Gemini CLI

Config file: `~/.gemini/settings.json` (global) or `.gemini/settings.json`
(project). Use the common `mcpServers` block. Or add via command:

```bash
gemini mcp add vtiger npx -y vtiger-mcp
```

(then set the `VTIGER_*` env vars in `settings.json`).

## Any other MCP client

Point it at the stdio command **`npx -y vtiger-mcp`** and provide the three
`VTIGER_*` environment variables. That's all any MCP client needs.

---

### Verify it's connected

Ask the agent *"list my vtiger modules"* or *"show my timesheets this
week."* From a terminal you can sanity-check the same credentials with the
CLI: `npx -y vtiger-mcp` is the server, while `npm i -g vtiger-mcp` gives
you `vtiger whoami`, `vtiger describe TimeControl`, etc.
