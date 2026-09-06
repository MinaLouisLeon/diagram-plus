# diagram-plus — Roadmap

> **What this is.** A visual block-diagram editor for designing an application before you build it,
> plus an MCP server so Claude Code can create, edit and *read* those diagrams. The diagram is a
> machine-writable, human-editable **spec** that sits between an idea and the code.

## The loop

```
1. In Claude Code:  "use diagram-plus to design a block diagram for my project idea"
                     └─> MCP tools write .diagrams/<name>.diagram.json
2. In the browser:  `dgp` opens the editor — you drag, drop, rename, rewire, fill in details
3. Either side:     you edit by hand, OR ask Claude to edit — both see changes live
4. You freeze it:   Save / "Mark ready"  → status: ready
5. In Claude Code:  "read the diagram and implement it"
                     └─> MCP returns a full structured implementation spec
                     └─> Claude writes the app, and marks blocks implemented as it goes
```

## Architecture

```
┌──────────────┐         ┌──────────────────────────┐         ┌──────────────┐
│  Claude Code │──stdio──│  @diagram-plus/mcp       │────┐    │   Browser    │
└──────────────┘         │  (MCP server, 27 tools)  │    │    │  editor UI   │
                         └──────────────────────────┘    │    └──────┬───────┘
                                                          ▼           │ HTTP+WS
                                        ┌──────────────────────────┐  │
                                        │  .diagrams/*.diagram.json│◄─┤
                                        │  (single source of truth)│  │
                                        └──────────────────────────┘  │
                                                          ▲           │
                         ┌──────────────────────────┐     │           │
                         │  @diagram-plus/server    │─────┘           │
                         │  REST + WS + file watch  │◄────────────────┘
                         └──────────────────────────┘
```

The **file on disk is the single source of truth**. The MCP server and the web server both read and
write it; the web server watches the directory and pushes changes to the browser over WebSocket.
That means the MCP server works whether or not the app is open, and the app updates live when Claude
edits the diagram.

## Packages

| Package | Purpose |
|---|---|
| `@diagram-plus/core` | Diagram schema (zod), typed block catalog, validation, file store, layout, spec generator, project tree, exporters |
| `@diagram-plus/server` | Local HTTP REST + WebSocket server, file watcher, static hosting, `dgp` CLI |
| `@diagram-plus/mcp` | stdio MCP server exposing the diagram as tools/resources/prompts |
| `@diagram-plus/web` | React + xyflow drag-and-drop editor |

---

## Phases

### Phase 0 — Foundation
- [x] npm workspaces monorepo, TypeScript project references, ESM throughout
- [x] Shared tsconfig, build + test + typecheck scripts
- [x] `.gitignore`, license, README skeleton, this roadmap

### Phase 1 — Core diagram model + file store
- [x] `Diagram` schema: id, name, goal, tech stack, status (draft/ready), revision, timestamps
- [x] **Typed blocks** — 15 kinds, each with its own structured payload:
      `ui_screen`, `ui_component`, `api_endpoint`, `service`, `function`, `data_model`,
      `datastore`, `external_service`, `job`, `event`, `decision`, `loop`, `config`,
      `note`, `custom`
- [x] **Typed edges** — `calls`, `data_flow`, `navigation`, `renders`, `reads`, `writes`,
      `emits`, `listens`, `depends_on`, `conditional`, `error_flow`
- [x] Groups (visual modules) and free notes
- [x] Zod validation + a semantic validator (dangling edges, empty models, orphans,
      type-compatibility warnings, duplicate names)
- [x] File store: `.diagrams/<slug>.diagram.json`, atomic writes, slug collisions,
      revision bumping, format migrations

### Phase 2 — Spec generator, layout, exporters
- [x] **Markdown implementation spec** — the artifact Claude reads to build the app:
      goal, stack, build order, per-block contracts, data models, endpoint tables, flows
- [x] Topological **build order** analysis (what to implement first)
- [x] Auto-layout engine (layered, dependency-aware) for MCP-created diagrams
- [x] Mermaid export, JSON export

### Phase 3 — Local server + CLI
- [x] REST API over the store (diagrams, blocks, edges, groups, status, spec, export)
- [x] Optimistic concurrency via `revision`
- [x] chokidar watch on `.diagrams/` with self-write de-duplication
- [x] WebSocket broadcast: `diagram:changed`, `diagram:created`, `diagram:deleted`
- [x] Static hosting of the built editor
- [x] `dgp` CLI: `open` (default), `mcp`, `init`, `export`, `install-mcp`

### Phase 4 — Web editor
- [x] Canvas: pan/zoom, minimap, grid, multi-select, box-select
- [x] Block palette with drag-and-drop onto the canvas
- [x] Per-type node rendering (colour, icon, key fields preview, status badge)
- [x] Draw typed connections between blocks, with an edge-type picker
- [x] **Inspector panel** — schema-driven forms per block type (fields, params,
      pseudo-code steps, endpoints, relations …)
- [x] Undo/redo, duplicate, delete, keyboard shortcuts
- [x] Diagram switcher + create/rename/delete
- [x] Validation panel (errors and warnings, click to focus the block)
- [x] Live-sync indicator, "Claude just edited this" awareness
- [x] Save / Mark-ready control, auto-layout button, export menu
- [x] Dark and light themes

### Phase 5 — MCP server
- [x] Discovery: `describe_block_schema` so Claude knows every field it can fill
- [x] Create: `create_diagram`, `create_diagram_from_outline` (whole diagram in one call)
- [x] Read: `list_diagrams`, `get_diagram`, `search_blocks`, `read_implementation_spec`
- [x] Edit: `add_blocks`, `update_block`, `delete_blocks`, `add_edges`, `update_edge`,
      `delete_edges`, `move_blocks`, `auto_layout`, `apply_batch`
- [x] Lifecycle: `set_diagram_status`, `validate_diagram`, `delete_diagram`, `export_diagram`
- [x] `open_editor` — hands the user the URL to review the diagram
- [x] MCP **resources** (`diagram://<slug>`) and **prompts** (`design_project`,
      `implement_from_diagram`)

### Phase 6 — Implementation bridge
- [x] `status: draft | ready` gating so Claude never implements a half-finished diagram
- [x] Per-block implementation status (`todo` / `in_progress` / `done`) + linked files
- [x] `mark_block_implemented` so progress is visible on the canvas while Claude codes
- [x] `implementation_progress` summary tool

### Phase 7 — Tests, docs, packaging
- [x] Vitest suites: schema, validation, store, layout, spec generator, REST API, MCP tools
- [x] End-to-end test of the whole loop (create → edit → ready → read spec)
- [x] README with install + usage, docs for the block catalog and MCP tools
- [x] `dgp install-mcp` writes the Claude Code `.mcp.json` entry

### Phase 8 — Sharing a diagram outside the repository
- [x] Portable export: one diagram as `.diagram.json` (the on-disk bytes, so it is
      also a drop-in), every diagram as a `.diagrams.json` bundle
- [x] Import that reads either back, matching by diagram id first so a renamed
      diagram still comes home to the right file
- [x] Collision dialog showing both sides before anything is overwritten —
      replace in place, keep both, or skip, per file
- [x] Native Save/Open dialogs on the desktop, download and file picker in the browser
- [x] `dgp export --out/--all`, `dgp import`, and the `import_diagram` MCP tool —
      none of which overwrite anything unless explicitly told to

### Phase 9 — Explaining a diagram to someone who did not draw it
- [x] `buildProjectTree` — the graph read as a tree of what the application does:
      entry screens first, technical blocks folded away, cycles cut with a pointer
      back to the first sighting
- [x] Conditions as branches — `decision` blocks matched to their `conditional`
      edges, `error_flow` paths labelled, all in the words already on the blocks
- [x] Conditions as filters — type, group, tag, implementation status and free text.
      A filtered block still conducts the flow, and what was removed is counted
      rather than quietly dropped
- [x] Three renderers: indented text, Markdown, and a Mermaid flowchart of the tree
      (a fraction of the size of the whole-diagram one)
- [x] **Client view** panel in the editor, with a client/technical toggle and the
      filters live; every row clicks back to its block on the canvas
- [x] **Present** — full-screen, large type, collapsible, `Esc` to leave
- [x] `read_project_tree` MCP tool, `tree`/`tree-markdown` export formats,
      `GET /api/diagrams/:slug/tree`, and `dgp tree`

---

## Progress

| Phase | Status | Landed in |
|---|---|---|
| 0 — Foundation | ✅ done | npm workspaces, shared tsconfig, build/test scripts |
| 1 — Core model | ✅ done | `packages/core` — 15 block types, 11 connection types, store, validator |
| 2 — Spec + layout | ✅ done | `spec.ts`, `layout.ts`, `analysis.ts`, `export.ts` |
| 3 — Server + CLI | ✅ done | `packages/server` — REST, WebSocket, file watch, `dgp` |
| 4 — Web editor | ✅ done | `packages/web` — canvas, palette, generated inspector, panels |
| 5 — MCP server | ✅ done | `packages/mcp` — 26 tools, 1 resource, 2 prompts |
| 6 — Implementation bridge | ✅ done | status gating, per-block progress, build-order panel |
| 7 — Tests + docs | ✅ done | 143 tests, README, generated block reference, MCP reference |
| 8 — Sharing | ✅ done | `core/transfer.ts`, import dialog, `dgp import`, `import_diagram` |
| 9 — Explaining | ✅ done | `core/tree.ts`, `core/tree-render.ts`, Client view panel, Present mode, `read_project_tree` |

**Everything in this roadmap is built.** `npm test` runs 173 tests across the three
non-UI packages, including an end-to-end pass over the whole loop and over the
export/import round trip; the editor was driven in a real browser to confirm the
canvas, the inspector, live sync, the progress panel, the import dialog and the
client view all work.
