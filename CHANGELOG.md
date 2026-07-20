# Changelog

All notable changes to this project are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.2] - 2026-07-13

### Fixed
- **Timesheet entries now record the project.** `log_timesheet` set only the
  task link (`related_to`) and left the entry's `projectid` empty, so the
  "Project name" column showed blank. The project is now auto-derived from
  the resolved task and written to `projectid` — callers don't need to pass
  it.
- The project was written using the *task* module's field name
  (`taskProjectField`) instead of the timesheet module's own project field.
  These are now distinct settings.

### Added
- `resolveTaskAndProject()` — resolves a task reference to both its id and
  its parent project in one step.
- `VTIGER_TS_PROJECT_FIELD` env override (default `projectid`).

## [0.2.1] - 2026-07-13

### Added
- Copy-paste **AI-agent install prompt** in the README — paste it into any
  file-editing AI agent to install and configure vtiger-mcp automatically.
- **CLIENTS.md** — per-client setup for Claude Desktop/Code, Cursor,
  Windsurf, Google Antigravity, VS Code (Copilot), OpenAI Codex CLI, Gemini
  CLI, and any MCP client.
- README badges (npm version, license, node).

### Changed
- Ship `CLIENTS.md` and `CHANGELOG.md` inside the published npm package.

## [0.2.0] - 2026-07-13

### Added
- **Configurable timesheet module.** The timesheet helpers default to
  `TimeControl` but now work on any vtiger install without code changes,
  via `VTIGER_TIMESHEET_MODULE`, `VTIGER_TASK_MODULE`,
  `VTIGER_PROJECT_MODULE`, and optional `VTIGER_TS_*_FIELD` field-name
  overrides (see `.env.example`).
- `CONTRIBUTING.md`, GitHub issue forms (bug / feature), and a PR template.

### Notes
- No breaking changes — defaults are unchanged for existing users.
- The generic `create_record` / `update_record` / `query` /
  `describe_module` tools work regardless of module names.

## [0.1.0] - 2026-07-13

### Added
- First public release.
- **MCP server** exposing vtiger CRM to AI agents, and a **CLI** over the
  same core.
- Generic tools (per-user access): `list_modules`, `describe_module`,
  `query` (VTQL), `retrieve_record`, `create_record`, `update_record`,
  `delete_record`.
- Timesheet helpers: `whoami`, `list_my_projects`, `list_my_tasks`,
  `log_timesheet`, `list_my_timesheets`, `update_timesheet`.
- Per-user authentication via each user's Webservice Access Key, so
  vtiger's role/profile and row-level sharing are preserved.
- Deletes disabled by default (`VTIGER_ALLOW_DELETE=false`).

[0.2.2]: https://github.com/ViralP17/vtiger-mcp/releases/tag/v0.2.2
[0.2.1]: https://github.com/ViralP17/vtiger-mcp/releases/tag/v0.2.1
[0.2.0]: https://github.com/ViralP17/vtiger-mcp/releases/tag/v0.2.0
[0.1.0]: https://github.com/ViralP17/vtiger-mcp/releases/tag/v0.1.0
