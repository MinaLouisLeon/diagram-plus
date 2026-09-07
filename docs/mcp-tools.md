# MCP tools

The diagram-plus MCP server exposes 31 tools, 1 resource and 2 prompts. Every tool
that targets a diagram takes `diagram` — its slug, its id, or its exact name.

Tool descriptions carry the block payload fields inline, so Claude knows what it can
fill in without a round trip. When in doubt it should call `describe_block_schema`.

---

## Discovery

### `describe_block_schema`
Lists every block type and connection type with the exact fields each payload
accepts. Optional `blockType` narrows it to one.

Call this first when designing something unfamiliar.

---

## Reading

### `list_diagrams`
Every diagram in the project, newest first.

### `get_diagram`
`detail: "outline"` (default) returns names, types, ids and connections — enough to
decide what to change. `detail: "full"` returns the complete JSON.

### `get_block`
One block in full, with its connections, as a focused spec plus the raw payload. Use
it when implementing a single piece.

### `search_blocks`
Find blocks by `query` (matched against name, summary, description, tags and
payload), `type`, or implementation `status`.

### `read_implementation_spec`
**The tool for building from a diagram.** Returns the whole specification as
Markdown: goal, tech stack, build order, every data model with its fields, every
endpoint with its request and response shapes, every service with its functions and
pseudo-code, every screen with its state and actions, the full connection table, and
the open gaps. Warns at the top when the diagram is still a draft.

### `read_project_tree`
**The tool for explaining a diagram.** Returns the same file as a plain tree of what
the application does — screens, the actions on them, and the conditions that decide
what happens next — with endpoints, services and data models folded away. Reach for
it when the design has to be reviewed with someone non-technical, rather than built.

| Argument | What it does |
|---|---|
| `audience` | `client` (default) folds the plumbing away; `technical` keeps every block |
| `format` | `text` (default), an indented tree, or `markdown` |
| `showConditions` | Turn decisions and conditional connections into branches. Default true |
| `showData` | Include data models and datastores. Default false |
| `maxDepth` | How far to follow a flow. Default 8 |
| `roots` | `groups` buckets the top level by group; `auto` (default) does so only if groups exist |
| `types`, `groups`, `tags`, `status`, `search` | Filters. A block ruled out never appears, but still conducts the flow, so the screens either side of a hidden endpoint stay connected |

Whatever the filters remove is counted in a footnote rather than disappearing quietly.

This is the read-only reading of the diagram. For the view the client actually
edits — a stored document with their wording and their additions in it — see
`read_client_view` below.

### `validate_diagram`
Dangling connections, empty blocks, duplicate names, relationships that do not make
sense between those block types, models relating to models that do not exist.

### `export_diagram`
`mermaid`, `markdown`, `json`, `tree` or `tree-markdown` — the last two render the
client view, with the defaults of `read_project_tree`.

---

## Creating

### `create_diagram`
An empty diagram: `name`, and optionally `description`, `projectGoal`, `techStack`,
`notes`.

### `create_diagram_from_outline`
**The tool for designing a project.** Creates the diagram, all of its blocks, all of
its connections, and lays it out — in one call. Connections may refer to blocks by
name, so everything can be wired up in the same call.

```jsonc
{
  "name": "Recipe Box",
  "projectGoal": "A household saves recipes and plans a week of meals.",
  "techStack": { "language": "TypeScript", "backend": "Fastify", "database": "PostgreSQL" },
  "blocks": [
    { "type": "data_model", "name": "Recipe",
      "data": { "tableName": "recipes",
                "fields": [{ "name": "id", "type": "uuid", "required": true },
                           { "name": "title", "type": "string", "required": true }] } },
    { "type": "api_endpoint", "name": "List recipes",
      "data": { "method": "GET", "path": "/api/recipes", "auth": "user" } },
    { "type": "ui_screen", "name": "Recipe list",
      "data": { "route": "/recipes", "purpose": "Browse saved recipes" } }
  ],
  "edges": [
    { "source": "Recipe list", "target": "List recipes", "type": "calls" },
    { "source": "List recipes", "target": "Recipe", "type": "reads" }
  ]
}
```

Fill in real field names, parameters and steps. Placeholders make the diagram look
finished while leaving the person reviewing it nothing to check.

---

## Editing

### `add_blocks`
Add blocks to an existing diagram. Re-runs auto-layout unless `layout: false`.

### `update_block`
Change a block. `patch.data` keys are **merged** over the existing payload, so a
single field can be filled in without resending the rest. Pass `replaceData: true`
to replace it outright.

### `delete_blocks`
Deletes blocks and every connection attached to them.

### `add_edges` · `update_edge` · `delete_edges`
Connect and reconnect blocks. Sources and targets may be ids or names.

### `apply_batch`
An ordered list of changes applied in one save. Later operations can refer to blocks
created by earlier ones by name. Operations: `add_block`, `update_block`,
`delete_block`, `add_edge`, `update_edge`, `delete_edge`, `move_block`, `add_group`,
`delete_group`, `set_status`.

Partial failure is reported rather than thrown: the operations that worked are kept
and the rest are listed with their index and reason.

### `move_blocks` · `auto_layout`
Position blocks by hand, or re-layer the whole diagram (`LR` or `TB`).

### `update_diagram_meta`
Name, description, project goal, tech stack, notes.

### `delete_diagram`
Deletes the file. Ask the user first.

---

## The client view

A second document, stored inside the diagram file: the same project as plain boxes
and arrows, in the words the client uses. The user reviews it with their client and
edits it while they talk, so it drifts from the technical diagram on purpose — that
drift is the record of what was asked for. These four tools read it, change it, and
bring the two documents back into line in either direction.

Start with `read_client_view`. Nothing is applied to the technical diagram until
`apply_client_view` is called.

### `read_client_view`
Boxes, arrows, the conditions between them, and — the part that matters — what the
client changed that the technical diagram does not have yet.

| Argument | What it does |
|---|---|
| `refresh` | Rebuild it from the diagram first, keeping the client's edits. Off by default, so reading never changes anything |

Every box says whether it was added in the review, reworded there, or has lost the
block it stood for.

### `update_client_view`
Edits the client view itself and nothing else. Use it to prepare a view before a
review, or to write up what was agreed in one.

`operations` is applied in order; later ones can refer to boxes added by earlier
ones. Boxes are addressed by their exact name or their id.

| Operation | Fields |
|---|---|
| `add_node` | `name`, `type` (any block type; defaults to `ui_screen`), `description`, `condition` and `branches` for a decision, `note` for what the client actually said, `after` to place it in the walkthrough |
| `update_node` | `node`, then any of `name`, `type`, `description`, `condition`, `branches`, `note` |
| `remove_node` | `node` — leaves a tombstone, so the next sync does not put it back |
| `add_edge` | `source`, `target`, `type` (defaults to `navigation`), `label`, `condition` |
| `remove_edge` | `source`, `target` |
| `reorder` | `order` — the walkthrough order; anything left out keeps its place at the end |
| `set_notes` | `notes` — free text from the review |

### `sync_client_view`
Rebuilds the view from the technical diagram **without losing what the client did to
it**: their wording is kept, their boxes are kept, their deletions stay deleted. Run
it after changing the diagram, so the next review shows the current design.

| Argument | What it does |
|---|---|
| `audience` | `client` (default) folds the plumbing away; `technical` keeps every block |
| `showConditions`, `showData` | As for `read_project_tree` |
| `types`, `groups`, `tags`, `search` | Filters, stored with the view so a later sync asks the same question |
| `rebuild` | Throw the current view away and derive a fresh one. This loses every edit made in front of the client — ask first |

### `apply_client_view`
Carries what the client changed into the technical diagram: their new boxes become
blocks of whatever type they were given, tagged `from-client`; their rewordings
become block names; their arrows become connections.

| Argument | What it does |
|---|---|
| `dryRun` | List the operations without running them |
| `includeRemovals` | Also delete the blocks the client removed. Off by default — a deletion is the one thing that cannot be undone from the other document |

The blocks it creates arrive thin: a name and a line. Working out that "text the
customer when it ships" is really a job plus an external service, and wiring it to
the rest, is the next piece of work — the tool response says which blocks need it.

---

## Building

### `set_diagram_status`
`draft` → still being designed · `ready` → the user approved it · `implemented`.
Only set `ready` when the user says so.

### `mark_block_implemented`
Record that a block is built and which files implement it. Call it as each piece
lands — the user watches the Progress panel fill in.

```jsonc
{ "diagram": "recipe-box", "block": "Recipe", "files": ["src/db/recipe.ts"] }
```

### `implementation_progress`
How much is built, and what is left in build order.

### `open_editor`
The URL where the user can review a diagram, and how to start the editor.

---

## Sharing

### `import_diagram`
Bring a diagram that came from another project into this one — a `.diagram.json`
the user was sent, or a `.diagrams.json` bundle of several. `file` is absolute or
relative to the project root.

Called without `action` it writes nothing and reports what each diagram in the file
would land on, so you can put the choice to the user before anything is overwritten:

```jsonc
{ "file": "~/Downloads/recipe-box.diagram.json" }
```

```
Nothing was written. 1 of the 1 diagram(s) in that file already exist here:

- "Recipe Box v2" (14 blocks) would land on "Recipe Box" (recipe-box, 11 blocks,
  last edited 2026-09-01T10:02:11.884Z), matched by id.

Ask the user whether to overwrite theirs, then call this again with
action="replace" — or action="copy" to keep both.
```

Once they have said which they want, pass it:

```jsonc
{ "file": "~/Downloads/recipe-box.diagram.json", "action": "replace" }
```

`replace` overwrites in place, keeping the local id and file name, so it reads as an
edit of one diagram rather than a delete and an add. `copy` adds the incoming one
alongside under a free name. Only ever set `action` after the user has chosen.

The matching is by diagram id first, then file name, then name — so a diagram that
was renamed while it was away still comes home to the right file.

---

## Resource

`diagram://index` — the list of diagrams in the project, as JSON.

## Prompts

### `design_project(idea)`
Walks through designing a project: learn the schema, decide the data models first,
then services, endpoints and screens, build it in one call, hand back the URL.

### `implement_from_diagram(diagram)`
Walks through building one: read the spec, follow the build order, treat the field
names and routes as the contract, ask rather than invent, and record progress.
