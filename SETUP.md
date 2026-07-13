# Setup Guide — for everyone (no coding needed)

This lets you **log your daily timesheet (Time Control) and add/update
records in the vtiger portal just by chatting** with an AI assistant
(Claude Desktop). After a one-time setup, you never touch any code or
terminal — you simply type things like:

> "Log 4 hours to the Website Redesign task today as regular hours."
> "Show my timesheets for this week."
> "Add a 2 hour entry to task X yesterday: fixed the login bug."

The assistant does it using **your own** vtiger account, so you can only
see and change what you're already allowed to in the portal.

---

## What you need (once)

1. **Node.js** — free. Install the **LTS** version from <https://nodejs.org/>
   (just click through the installer with defaults).
2. **Claude Desktop** — the app you'll chat in. Download from
   <https://claude.ai/download> and sign in.
3. **This `vtiger-mcp` folder** on your computer (ask your team lead for
   it, or clone the repo).
4. **Your Webservice Access Key** (see next section).

### How to find your Webservice Access Key

This is **not** your login password.

1. Log in to your vtiger CRM (e.g. https://yourcrmdomain.com).
2. Click your **name** at the top-right → **My Preferences**.
3. Scroll to the field **"Webservice Access Key"** (a 16-character code).
4. Copy it. You'll paste it once during setup.

> If that field is empty, ask an admin to re-save your user record so a
> key gets generated.

---

## Track A — Easiest (Windows + Claude Desktop)

A helper script does everything for you.

1. Open the `vtiger-mcp` folder in File Explorer.
2. **Right-click `setup.ps1` → "Run with PowerShell".**
   - If Windows blocks it, open PowerShell and run:
     `powershell -ExecutionPolicy Bypass -File setup.ps1`
3. Answer the two prompts:
   - **Portal URL** — just press Enter to accept the default.
   - **Username** — your vtiger login (e.g. `jsmith`).
   - **Access Key** — paste the key from My Preferences.
4. When it says *"Config written"*, **fully quit Claude Desktop**
   (right-click the tray icon → Quit) and **open it again**.
5. Start chatting — try: *"Show my timesheets for this week."*

That's it. You're done. 🎉

---

## Track B — Manual setup (Mac/Linux, or Cursor / Claude Code)

If you're not on Windows, or you use a different AI client, add the
config by hand.

1. In a terminal, inside the `vtiger-mcp` folder, run once:
   ```
   npm install
   npm run build
   ```
2. Note the **full path** to `dist/mcp/server.js` inside this folder.
3. Open your client's config file and add the `vtiger` block below,
   replacing the path and your details. A ready template is in
   [`examples/claude_desktop_config.json`](examples/claude_desktop_config.json).

   **Claude Desktop config location:**
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

   **Cursor:** a `.mcp.json` in your project (same `mcpServers` shape).
   **Claude Code:** run `claude mcp add` or edit `.mcp.json`.

   ```json
   {
     "mcpServers": {
       "vtiger": {
         "command": "node",
         "args": ["/full/path/to/vtiger-mcp/dist/mcp/server.js"],
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
4. Fully restart the client.

---

## What you can ask for

Timesheets (the daily Time Control entries):
- *"Log a timesheet: task 'Website Redesign', 9:00 to 13:00 today, regular hours, note 'team meeting + planning'."*
- *"Add 3 hours to task X yesterday as extra hours."*
- *"What tasks can I log time against?"* (lists your project tasks)
- *"Show my timesheets between 1 and 13 July."*
- *"Change the note on my last entry to '…'."*

Any other module you have access to:
- *"Create a project task called 'Write docs' under project Y."*
- *"Find contacts whose name contains 'Patel'."* (read-only search)
- *"Update record 17x1234: set the status to In Progress."*

The assistant will ask for anything it needs (like which task you mean)
and will show you what it created.

---

## Already using other MCP servers?

Track A **overwrites** `claude_desktop_config.json` (it saves a
`.backup` first). If you already have other servers configured, open the
`.backup` file and copy their entries into the new file's `mcpServers`
object, next to `"vtiger"`. Each server is just one more key:

```json
"mcpServers": {
  "vtiger": { ... },
  "some-other-server": { ... }
}
```

---

## Troubleshooting

- **"vtiger" tools don't appear in Claude Desktop** → make sure you
  *fully quit* and reopened it (not just closed the window). Check the
  config file has no typos (valid JSON).
- **"Access key for the user is undefined" / login fails** → the Access
  Key is wrong or empty. Re-copy it from My Preferences.
- **403 Forbidden / can't connect** → the portal's `webservice.php` must
  be reachable (an admin one-time change). Contact your team lead.
- **"Permission … denied" when creating/deleting** → your vtiger account
  doesn't have that right. This is expected — the tool respects your
  portal permissions.
- **Deleting is blocked** → deletes are off by default for safety. An
  admin can enable it by setting `VTIGER_ALLOW_DELETE` to `true` in the
  config, if your account even has delete rights.

---

## Fastest path for developers (npm)

If you're comfortable editing a JSON config, you don't need this folder at
all — the package is on npm. Just point your client at it with `npx`:

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

`npx` fetches and runs `vtiger-mcp` automatically. For a CLI, run
`npm install -g vtiger-mcp` then use `vtiger …` (see the main README).

For non-developers on Windows, **Track A (`setup.ps1`)** remains the
simplest per-person path.
