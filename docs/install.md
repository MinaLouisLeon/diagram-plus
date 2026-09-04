# Installing the MCP server

`npm run install-mcp` (or `dgp install-mcp`) registers the diagram-plus MCP server
with every MCP-capable AI tool on your machine. It is a dependency-free script, so it
runs before anything is built — and offers to build for you if it needs to.

## What it supports

| Tool | Local (project) | Global (user) |
|---|---|---|
| Claude Code | `.mcp.json` | `~/.claude.json` |
| Claude Desktop | — | `claude_desktop_config.json` ¹ |
| Codex CLI | — | `~/.codex/config.toml` |
| Cursor | `.cursor/mcp.json` | `~/.cursor/mcp.json` |
| Windsurf | — | `~/.codeium/windsurf/mcp_config.json` |
| VS Code (Copilot) | `.vscode/mcp.json` | user `settings.json` ² |
| Gemini CLI | `.gemini/settings.json` | `~/.gemini/settings.json` |

¹ `~/Library/Application Support/Claude/` on macOS, `%APPDATA%\Claude\` on Windows,
`~/.config/Claude/` on Linux.

² VS Code user settings are JSONC, and rewriting that file would strip your comments.
The installer uses `code --add-mcp` when VS Code is on your PATH, and otherwise prints
the exact snippet for you to paste. It never rewrites the file itself.

Run `--list` to see the same table with detection results for your machine.

## Local or global

**Local** writes config files into the repository. Commit them and everyone who
clones the project gets the server, pointed at that project.

**Global** writes your user config, so the server is available everywhere.

The difference that matters is the project path:

- **Terminal tools** (Claude Code, Codex, Gemini) are launched from a directory, so a
  global install deliberately leaves `DIAGRAM_PLUS_ROOT` unset. The server then finds
  the nearest project — the first directory up the tree with `.diagrams/`, `.git` or
  `package.json` — so one install works in every project.
- **Desktop apps** (Claude Desktop, Cursor, Windsurf, VS Code) have no meaningful
  working directory, so they need a project pinned. On a global install the installer
  asks which one, and only if you actually selected one of them.

A local install always pins the path, since there is exactly one project it can mean.

## Flags

```
--scope <local|global>   Where to install
--local, --global        Shorthand
--project <path>         Project root (default: nearest project to the cwd)
--clients <a,b,c>        Only these tools, by id
--all                    Include tools that are not detected
--uninstall              Remove the server instead
--dry-run                Show the changes, write nothing
--list                   Show the supported tools and their config paths
--yes, -y                Take the defaults, ask nothing
--no-build               Never offer to build the server first
--help, -h               Full help
```

Ids: `claude-code`, `claude-desktop`, `codex`, `cursor`, `windsurf`, `vscode`,
`gemini-cli`.

## What it will and will not do

- It **merges**. Servers other tools or you put in those files are left untouched, and
  so is unrelated configuration — `~/.claude.json` keeps its state, `config.toml`
  keeps its other tables.
- It **backs up** every existing file before changing it, to
  `<file>.backup-<timestamp>`.
- It is **idempotent**. Running it twice reports "already set" and writes nothing.
- It **refuses rather than guesses**. A config file it cannot parse is reported and
  left exactly as it was.
- `--uninstall` removes only the `diagram-plus` entry.

## After installing

Restart the tool — the installer prints the specific step for each one — then:

> use diagram-plus to design a block diagram for my project

and open the editor with `dgp` to review what it draws.

## Troubleshooting

**The tool does not list the server.** Most clients only read their config at
startup. Quit it fully and reopen — for desktop apps that means quitting the
application, not just closing the window.

**"The MCP server is not built yet".** Run `npm run build` in the diagram-plus
repository. The installer offers to do this for you when it is run from a checkout.

**The server starts but finds no diagrams.** It resolves the project from
`DIAGRAM_PLUS_ROOT`, or from the working directory when that is unset. Check the path
in the config file, or run `dgp list` in the project to confirm where diagrams live.

**Moved the diagram-plus checkout.** The config records an absolute path to
`packages/mcp/dist/bin.js`. Run the installer again to update it.
