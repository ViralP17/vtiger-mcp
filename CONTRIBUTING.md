# Contributing to vtiger-mcp

Thanks for your interest in improving vtiger-mcp! Contributions of all
kinds are welcome — bug reports, docs, and code.

## Ground rules

- **Never commit secrets.** No real access keys, passwords, CRM domains,
  customer/project names, or record ids in code, tests, docs, or commit
  messages. Use placeholders like `https://yourcrmdomain.com`,
  `your.username`, `17x1234`.
- Be respectful and constructive. Assume good intent.

## Getting started

```bash
git clone https://github.com/ViralP17/vtiger-mcp.git
cd vtiger-mcp
npm install
npm run build      # compile TypeScript to dist/
npm run typecheck  # type-only check
```

To try it against a vtiger install, copy `.env.example` to `.env` and fill
in your own credentials (the `.env` file is git-ignored):

```bash
node dist/cli/index.js whoami
node dist/cli/index.js describe TimeControl
```

## Project layout

```
src/core/    shared client (auth, transport, CRUD) + timesheet helpers
src/mcp/     MCP stdio server (registers tools, delegates to core)
src/cli/     thin CLI over the same core
examples/    sample MCP client config
```

- `src/core/client.ts` — auth handshake, session handling, generic
  operations. Keep it dependency-free and permission-neutral (vtiger
  enforces access; we don't).
- `src/core/timesheet.ts` — timesheet module/field mapping. New installs
  with different module/field names should be handled via
  `timesheetConfigFromEnv` (env-driven), not hardcoding.

## Making a change

1. Create a branch: `git checkout -b fix/short-description`.
2. Make the change; run `npm run build` and `npm run typecheck`.
3. If you touched behavior, verify with the CLI against a real vtiger
   (or describe how you tested in the PR).
4. Keep the diff focused; match the surrounding code style.
5. Open a PR against `main` with a clear description and, for bugs, the
   before/after behavior.

## Reporting bugs / requesting features

Please use the issue templates. Include your vtiger version, the tool
version (`npm ls vtiger-mcp` or the `vtiger --help` output), and the exact
tool/CLI command and (sanitized) error.

## Releases

- `main` is the development branch.
- Version bumps follow [semver](https://semver.org/). Maintainers publish
  to npm (`npm publish --access public`) and tag `vX.Y.Z` on GitHub.

By contributing, you agree your contributions are licensed under the
project's [MIT License](LICENSE).
