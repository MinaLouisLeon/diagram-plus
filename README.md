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

```bash
git clone https://github.com/MinaLouisLeon/diagram-plus
cd diagram-plus
npm install
npm run build
```

Then, in the project you want to design:

```bash
cd ~/code/my-project
node /path/to/diagram-plus/packages/server/dist/cli.js init
node /path/to/diagram-plus/packages/server/dist/cli.js install-mcp
```

`install-mcp` writes the server into your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "diagram-plus": {
      "command": "node",
      "args": ["/path/to/diagram-plus/packages/mcp/dist/bin.js"],
      "env": { "DIAGRAM_PLUS_ROOT": "/Users/you/code/my-project" }
    }
  }
}
```

Restart Claude Code so it picks the server up. Then start the editor:

```bash
dgp          # or: node /path/to/diagram-plus/packages/server/dist/cli.js
```

It prints a URL — usually <http://localhost:4517>.

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
dgp install-mcp         Register the MCP server in .mcp.json
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
npm run build       # core → editor → server → mcp
npm test            # 100 tests across core, server and mcp
npm run typecheck

# editor with hot reload (needs `dgp` running on 4517 in another terminal)
npm run dev
```

[ROADMAP.md](ROADMAP.md) lays out the phases and what each one contains.

## Licence

MIT
