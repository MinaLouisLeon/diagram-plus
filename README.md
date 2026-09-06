# diagram-plus

Design your application as a block diagram, then have Claude Code build it.

diagram-plus is two things that share one file:

- **A visual editor** — a drag-and-drop canvas of typed blocks (screens, endpoints,
  services, data models, jobs…) connected by typed relationships.
- **An MCP server** — 25 tools that let Claude Code create, edit and *read* those
  same diagrams.

The diagram is a **machine-writable, human-editable specification** that sits between
an idea and the code: richer than a prompt, lighter than a design document, and
readable by both of you.

---

## The loop

```
1. In Claude Code   "use diagram-plus to design a block diagram for my project idea"
                    → Claude writes .diagrams/<name>.diagram.json

2. In your browser  `dgp` opens the editor — drag, rename, rewire, fill in the details

3. Either side      you edit by hand, or ask Claude to edit — both see it live

4. You freeze it    press "Mark ready"

5. In Claude Code   "read the diagram and implement it"
                    → Claude gets the full specification and writes the app,
                      ticking off each block as it goes
```

Nothing is hidden in a database. Diagrams live as pretty-printed JSON in
`.diagrams/` inside your project, so they are reviewed and committed alongside the
code they describe.

---

## Install

Two ways in. The **desktop app** is a single installer with nothing else to set
up; the **repository** is the one to clone if you want the `dgp` CLI or intend
to work on diagram-plus itself.

### The desktop app

Download the installer for your platform from the
[releases page](https://github.com/MinaLouisLeon/diagram-plus/releases) —
`.exe`/`.msi` for Windows, `.dmg` for macOS, `.AppImage`/`.deb`/`.rpm` for
Linux. Open it, pick a project folder, and the editor is there.

It carries the MCP server with it: the gear in the toolbar finds the AI tools on
your machine and registers diagram-plus with them, so there is no terminal step.
(That server runs on Node 20+, which is the one thing to have installed.)

Full details, including how to build it yourself: [docs/desktop.md](docs/desktop.md).

### From the repository

Node 20 or newer, on Windows, macOS or Linux.

```bash
git clone https://github.com/MinaLouisLeon/diagram-plus
cd diagram-plus
npm install
npm run install-mcp
```

That last command is an installer that finds every MCP-capable AI tool on your
machine and configures them all. It asks two questions — where to install, and which
tools — then writes each one's config in its own format.

```
  Where should the server be installed?

    ( ) local    this project only
        writes .mcp.json, .cursor/mcp.json and friends into the
        repository, so anyone who clones it gets the server too
  > (o) global   every project on this machine
        writes your user config; terminal tools then pick up the
        diagrams of whichever project you run them in

  up/down move · enter confirms
```

```
  Which tools should get the server? (global install)
  Detected tools are ticked already.

  > [x] Claude Code          detected
        ~/.claude.json
    [ ] Claude Desktop       not detected
        ~/Library/Application Support/Claude/claude_desktop_config.json
    [x] Codex CLI            detected
        ~/.codex/config.toml
    [x] Cursor               detected
        ~/.cursor/mcp.json
    [ ] Windsurf             not detected
        ~/.codeium/windsurf/mcp_config.json
    [x] VS Code (Copilot)    detected
        ~/Library/Application Support/Code/User/settings.json
    [ ] Gemini CLI           not detected
        ~/.gemini/settings.json

  up/down move · space toggles · a all · n none · enter confirms
```

Move with the arrow keys, tick with **space**, confirm with **enter** — the tools it
detected are ticked for you. **a** ticks everything, **n** clears it, and **escape**
backs out without writing anything.

It supports **Claude Code**, **Claude Desktop**, **Codex CLI**, **Cursor**,
**Windsurf**, **VS Code (Copilot)** and **Gemini CLI**. Existing servers in those
files are left alone, and anything it changes is backed up first.

If the project has not been built yet, the installer offers to build it for you —
`npm run build:libs`, which is the core, MCP and server packages. The browser editor
is not part of that: the MCP server does not need it, and leaving it out keeps the
install off the one build step with platform-specific binaries.

### Local or global?

|  | What it writes | When to use it |
|---|---|---|
| **local** | project files — `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, `.gemini/settings.json` | You want the diagram tooling committed with the repo, so anyone who clones it gets the server too. The project path is pinned. |
| **global** | your user config — `~/.claude.json`, `~/.codex/config.toml`, `~/.cursor/mcp.json`, … | You want it everywhere. Terminal tools then pick up the diagrams of whichever project you run them in. |

Desktop apps (Claude Desktop, Cursor, Windsurf, VS Code) have no working directory,
so on a global install the installer asks which project they should open and pins
that path in. Terminal tools (Claude Code, Codex, Gemini) get no pinned path, so one
global install works across all your projects.

### Without the prompts

```bash
npm run install-mcp -- --global --yes            # every detected tool
npm run install-mcp -- --local --project ~/app   # this project only
npm run install-mcp -- --clients claude-code,codex --global --yes
npm run install-mcp -- --list                    # what is supported, and where
npm run install-mcp -- --dry-run --global        # show the changes, write nothing
npm run install-mcp -- --uninstall --global      # remove it again
```

`dgp install-mcp` runs the same installer and takes the same flags. Without a terminal
to draw the list in — a pipe, a CI job, some IDE consoles — it asks for numbers
instead, and `--yes` skips the questions altogether. Full reference:
[docs/install.md](docs/install.md).

Once it is done, restart the tool it configured, then start the editor from any
project:

```bash
dgp
```

It prints a URL — usually <http://localhost:4517>.

### If the install does not go through

**"The MCP server is not built yet" and the build fails.** Whatever npm printed is
the reason — the installer passes it through rather than summarising it. Run the
build on its own if you want to iterate on the error:

```bash
npm run build:libs
npm run install-mcp
```

**"Cannot find module @rollup/rollup-win32-x64-msvc"** (or the equivalent for another
platform) while building or testing. This is [npm's optional-dependency
bug](https://github.com/npm/cli/issues/4828): the lockfile has the binary, `npm
install` skips it. It affects the browser editor and the test runner, neither of
which the MCP server needs, so the install itself still goes through. To fix the
rest, put the binary back:

```bash
npm install @rollup/rollup-win32-x64-msvc --no-save --no-package-lock
```

Or reinstall from scratch: delete `node_modules` and `package-lock.json`, then run
`npm install` again.

**The build reports success but nothing appears in `dist`.** A leftover
`tsconfig.tsbuildinfo` is telling tsc that everything is already up to date. Run
`npm run clean`, then build again. (The installer clears them itself before it
builds.)

---

## Using it

### Ask Claude to design your project

> use diagram-plus to design a block diagram for a recipe app where a household
> saves recipes, plans a week of meals, and gets a shopping list

Claude calls `describe_block_schema` to learn what a block can hold, then
`create_diagram_from_outline` to build the whole thing — blocks, connections and
layout — in one call, and hands you the URL.

### Review and edit it yourself

Open the URL. Drag block types in from the palette, drag between blocks to connect
them, and click a block to edit it. The inspector shows the fields that matter for
that kind of block: a data model gets fields, relations and indexes; an endpoint gets
a method, path, request body and error cases; a function gets parameters and
pseudo-code steps.

Everything saves as you type. Press **Spec** to see exactly what Claude will read.

### Ask Claude to edit it

> in the recipe diagram, add a shopping list screen and connect it to the shopping
> list endpoint

Changes appear on the canvas within a second — no refresh.

### Build it

Press **Mark ready**, then:

> read the recipe-box diagram and implement it

Claude reads the specification — goal, tech stack, build order, every model,
endpoint, service and screen with its fields — and writes the project. As each piece
lands it calls `mark_block_implemented`, so the **Progress** panel fills in while you
watch.

---

## The block types

Fifteen types, each with its own structured payload. That structure is the point: it
is what lets Claude generate real routes, schemas and functions instead of guessing
from prose.

| | Type | For |
|---|---|---|
| 🖥 | `ui_screen` | A page: route, state, actions |
| 🧩 | `ui_component` | A reusable component: props, events |
| 🔌 | `api_endpoint` | An HTTP route: method, path, request, responses, errors |
| ⚙️ | `service` | A module of business logic and its functions |
| ƒ | `function` | One function, written out as pseudo-code steps |
| 🗃 | `data_model` | An entity: fields, relations, indexes, constraints |
| 💾 | `datastore` | A database, cache or bucket |
| 🌐 | `external_service` | A third-party API you call |
| ⏱ | `job` | Scheduled or background work |
| 📣 | `event` | A message published and consumed |
| 🔀 | `decision` | A branch in the flow |
| 🔁 | `loop` | Repeated work |
| 🔑 | `config` | Environment variables and settings |
| 📝 | `note` | A sticky note |
| ✳️ | `custom` | Anything the others do not cover |

Connections are typed too — `calls`, `data_flow`, `navigation`, `renders`, `reads`,
`writes`, `emits`, `listens`, `depends_on`, `conditional`, `error_flow` — and the
validator uses them: a data model cannot "navigate" to a screen, and it will say so.

Full details: [docs/block-types.md](docs/block-types.md).

---

## The `dgp` command

```
dgp [open]              Start the editor and print its URL (default)
dgp mcp                 Run the MCP server on stdio
dgp init                Create .diagrams in this project
dgp list                List the diagrams in this project
dgp spec <diagram>      Print the implementation spec as Markdown
dgp export <diagram>    Print the diagram (--format mermaid|markdown|json)
dgp validate <diagram>  Report problems with a diagram
dgp install-mcp         Register the MCP server with your AI tools
```

---

## MCP tools

25 tools, grouped by what they are for. Full reference:
[docs/mcp-tools.md](docs/mcp-tools.md).

**Discovery** `describe_block_schema`
**Reading** `list_diagrams` · `get_diagram` · `get_block` · `search_blocks` · `read_implementation_spec` · `validate_diagram` · `export_diagram`
**Creating** `create_diagram` · `create_diagram_from_outline`
**Editing** `add_blocks` · `update_block` · `delete_blocks` · `add_edges` · `update_edge` · `delete_edges` · `apply_batch` · `move_blocks` · `auto_layout` · `update_diagram_meta` · `delete_diagram`
**Building** `set_diagram_status` · `mark_block_implemented` · `implementation_progress` · `open_editor`

Two prompts are exposed as well: `design_project` and `implement_from_diagram`.

---

## How it fits together

```
┌──────────────┐         ┌──────────────────────────┐         ┌──────────────┐
│  Claude Code │──stdio──│  @diagram-plus/mcp       │────┐    │   Browser    │
└──────────────┘         └──────────────────────────┘    │    │  editor UI   │
                                                          ▼    └──────┬───────┘
                                        ┌──────────────────────────┐  │ HTTP+WS
                                        │  .diagrams/*.diagram.json│◄─┤
                                        │  (single source of truth)│  │
                                        └──────────────────────────┘  │
                                                          ▲           │
                         ┌──────────────────────────┐     │           │
                         │  @diagram-plus/server    │─────┘           │
                         │  REST + WS + file watch  │◄────────────────┘
                         └──────────────────────────┘
```

The file on disk is the single source of truth. Both sides go through the same
mutation primitives, so an edit made by dragging a block and an edit made by Claude
are indistinguishable by the time they reach the file. The server watches
`.diagrams/` and pushes changes to open tabs, which is why Claude's edits appear live.

| Package | Purpose |
|---|---|
| `@diagram-plus/core` | Schema, catalog, validation, file store, layout, spec generator, exporters |
| `@diagram-plus/server` | Local HTTP + WebSocket server, file watcher, `dgp` CLI |
| `@diagram-plus/mcp` | The MCP server |
| `@diagram-plus/web` | The React editor |

---

## Development

```bash
npm install
npm run build       # core → mcp → server → editor
npm run build:libs  # the same without the editor — all the MCP server needs
npm test            # 112 tests across core, server and mcp
npm run typecheck
npm run clean       # drop every dist/ and tsconfig.tsbuildinfo

# editor with hot reload (needs `dgp` running on 4517 in another terminal)
npm run dev
```

[ROADMAP.md](ROADMAP.md) lays out the phases and what each one contains.

## Licence

MIT
