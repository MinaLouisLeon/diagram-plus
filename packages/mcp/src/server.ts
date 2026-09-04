import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  BLOCK_TYPES,
  DiagramStore,
  addBlocks,
  addEdges,
  applyBatch,
  autoLayout,
  buildOrder,
  deleteBlocks,
  deleteEdges,
  diagramStats,
  exportDiagram,
  findBlock,
  generateBlockSpec,
  generateSpec,
  markImplemented,
  moveBlocks,
  updateBlock,
  updateEdge,
  validateDiagram,
  type BatchOperation,
  type Diagram,
} from '@diagram-plus/core';
import {
  allBlockTypesHint,
  allEdgeTypesHint,
  blockDataHint,
  catalogJson,
} from './hints.js';
import {
  batchOperationSchema,
  blockInputSchema,
  blockPatchSchema,
  blockRef,
  blockTypeEnum,
  diagramRef,
  edgeInputSchema,
  edgeTypeEnum,
  techStackSchema,
} from './schemas.js';

export const DEFAULT_EDITOR_PORT = 4517;

export interface McpServerOptions {
  store: DiagramStore;
  /** URL of the local editor, used in hints back to the user. */
  editorUrl?: string;
}

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

const text = (body: string): ToolResult => ({ content: [{ type: 'text', text: body }] });

const fail = (message: string): ToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

function block(title: string, body: string, lang = 'json'): string {
  return `${title}\n\n\`\`\`${lang}\n${body}\n\`\`\``;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** One-line state of the diagram, appended after every mutation. */
function changeSummary(diagram: Diagram, editorUrl: string): string {
  const stats = diagramStats(diagram);
  const validation = validateDiagram(diagram);
  const parts = [
    `"${diagram.name}" (${diagram.slug}) is now at revision ${diagram.revision}: ` +
      `${stats.blocks} blocks, ${stats.edges} connections, status ${diagram.status}.`,
  ];
  if (validation.errors.length) {
    parts.push(`${validation.errors.length} error(s): ${validation.errors.map((e) => e.message).join(' ')}`);
  }
  if (validation.warnings.length) {
    parts.push(`${validation.warnings.length} warning(s) — run validate_diagram for details.`);
  }
  parts.push(`Review it at ${editorUrl}/d/${diagram.slug}`);
  return parts.join('\n');
}

export function createMcpServer(options: McpServerOptions): McpServer {
  const { store } = options;
  const editorUrl = options.editorUrl ?? `http://localhost:${DEFAULT_EDITOR_PORT}`;

  const server = new McpServer(
    { name: 'diagram-plus', version: '0.1.0' },
    {
      instructions: [
        'diagram-plus stores block diagrams that describe an application before it is built.',
        'A diagram is a typed graph: blocks (screens, endpoints, services, data models, jobs…)',
        'connected by typed relationships. The user reviews and edits the same diagram in a',
        'visual editor, so keep names and details clear enough for a person to read.',
        '',
        'Typical flow:',
        '1. create_diagram_from_outline — turn the user\'s idea into a first diagram.',
        '2. The user opens the editor, edits it, and marks it ready.',
        '3. read_implementation_spec — get the full spec, then build the project from it.',
        '4. mark_block_implemented — record progress as each piece is written.',
        '',
        'Call describe_block_schema first if you are unsure what a block type can hold.',
      ].join('\n'),
    },
  );

  /** Load, mutate, save — with the standard summary and error handling. */
  async function mutate(
    ref: string,
    mutator: (diagram: Diagram) => string | void,
  ): Promise<ToolResult> {
    try {
      let note = '';
      const { diagram } = await store.update(ref, (draft) => {
        note = mutator(draft) ?? '';
      });
      return text([note, changeSummary(diagram, editorUrl)].filter(Boolean).join('\n\n'));
    } catch (err) {
      return fail(errorMessage(err));
    }
  }

  async function withDiagram(
    ref: string,
    fn: (diagram: Diagram) => ToolResult | Promise<ToolResult>,
  ): Promise<ToolResult> {
    try {
      return await fn(await store.read(ref));
    } catch (err) {
      return fail(errorMessage(err));
    }
  }

  /* ================================================================ *
   * Discovery
   * ================================================================ */

  server.registerTool(
    'describe_block_schema',
    {
      title: 'Describe the block catalog',
      description:
        'List every block type and connection type, with the exact fields each block payload accepts. ' +
        'Call this before building a diagram if you are unsure which type fits or what to put in `data`.',
      inputSchema: {
        blockType: blockTypeEnum.optional().describe('Limit the answer to one block type.'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ blockType }) =>
      text(
        block(
          blockType ? `Schema for the "${blockType}" block:` : 'The diagram-plus block catalog:',
          JSON.stringify(catalogJson(blockType), null, 2),
        ),
      ),
  );

  /* ================================================================ *
   * Reading
   * ================================================================ */

  server.registerTool(
    'list_diagrams',
    {
      title: 'List diagrams',
      description: 'List every diagram in this project, newest first.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const list = await store.list();
      if (!list.length) {
        return text(
          `No diagrams yet in ${store.dir}. Use create_diagram_from_outline to design one.`,
        );
      }
      const lines = list.map(
        (d) =>
          `- **${d.name}** (\`${d.slug}\`) — ${d.status}, ${d.blockCount} blocks, ` +
          `${d.edgeCount} connections, updated ${d.updatedAt}${d.description ? ` — ${d.description}` : ''}`,
      );
      return text(`${list.length} diagram(s) in ${store.dir}:\n\n${lines.join('\n')}`);
    },
  );

  server.registerTool(
    'get_diagram',
    {
      title: 'Get a diagram',
      description:
        'Read a diagram. `full` returns the complete JSON (every block payload); ' +
        '`outline` returns names, types and connections only — enough to decide what to change next.',
      inputSchema: {
        diagram: diagramRef,
        detail: z.enum(['outline', 'full']).optional().describe('Defaults to outline.'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ diagram, detail = 'outline' }) =>
      withDiagram(diagram, (d) => {
        if (detail === 'full') {
          return text(block(`Full JSON for "${d.name}":`, JSON.stringify(d, null, 2)));
        }
        const byId = new Map(d.blocks.map((b) => [b.id, b]));
        const blocks = d.blocks
          .map(
            (b) =>
              `- \`${b.id}\` **${b.name}** (${b.type}) — ${b.implementation.status}` +
              `${b.summary ? ` — ${b.summary}` : ''}`,
          )
          .join('\n');
        const edges = d.edges
          .map(
            (e) =>
              `- \`${e.id}\` ${byId.get(e.source)?.name ?? e.source} —${e.type}→ ` +
              `${byId.get(e.target)?.name ?? e.target}${e.condition ? ` (when ${e.condition})` : ''}`,
          )
          .join('\n');
        return text(
          [
            `# ${d.name} (\`${d.slug}\`)`,
            `Status: ${d.status} · revision ${d.revision}`,
            d.description && `\n${d.description}`,
            d.projectGoal && `\n**Goal:** ${d.projectGoal}`,
            `\n## Blocks (${d.blocks.length})\n${blocks || '_none_'}`,
            `\n## Connections (${d.edges.length})\n${edges || '_none_'}`,
            `\nCall get_diagram with detail="full" for every field, or read_implementation_spec to build from it.`,
          ]
            .filter(Boolean)
            .join('\n'),
        );
      }),
  );

  server.registerTool(
    'get_block',
    {
      title: 'Get one block',
      description: 'Read a single block in full, with its connections — use it when implementing one piece.',
      inputSchema: { diagram: diagramRef, block: blockRef },
      annotations: { readOnlyHint: true },
    },
    async ({ diagram, block: ref }) =>
      withDiagram(diagram, (d) => {
        const found = findBlock(d, ref);
        if (!found) return fail(`No block matching "${ref}" in "${d.name}".`);
        return text(
          `${generateBlockSpec(d, found)}\n${block('Raw payload:', JSON.stringify(found, null, 2))}`,
        );
      }),
  );

  server.registerTool(
    'search_blocks',
    {
      title: 'Search blocks',
      description: 'Find blocks by text, type or implementation status across one diagram.',
      inputSchema: {
        diagram: diagramRef,
        query: z.string().optional().describe('Matched against name, summary, description and tags.'),
        type: blockTypeEnum.optional(),
        status: z.enum(['todo', 'in_progress', 'done', 'blocked']).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ diagram, query, type, status }) =>
      withDiagram(diagram, (d) => {
        const needle = query?.toLowerCase();
        const matches = d.blocks.filter((b) => {
          if (type && b.type !== type) return false;
          if (status && b.implementation.status !== status) return false;
          if (!needle) return true;
          const haystack = [b.name, b.summary, b.description, ...b.tags, JSON.stringify(b.data)]
            .join(' ')
            .toLowerCase();
          return haystack.includes(needle);
        });
        if (!matches.length) return text('No blocks matched.');
        return text(
          `${matches.length} match(es):\n\n` +
            matches
              .map((b) => `- \`${b.id}\` **${b.name}** (${b.type}) — ${b.summary || b.description || '—'}`)
              .join('\n'),
        );
      }),
  );

  server.registerTool(
    'read_implementation_spec',
    {
      title: 'Read the implementation spec',
      description:
        'Return the full Markdown specification for a diagram: goal, tech stack, build order, ' +
        'every data model, endpoint, service and screen with its fields, plus the open gaps. ' +
        'This is what you implement the project from.',
      inputSchema: {
        diagram: diagramRef,
        includeDiagram: z.boolean().optional().describe('Include the Mermaid overview. Default true.'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ diagram, includeDiagram = true }) =>
      withDiagram(diagram, (d) => {
        const spec = generateSpec(d, { includeDiagram });
        const preamble =
          d.status === 'draft'
            ? 'Note: this diagram is still a draft. Confirm with the user before writing code from it.\n\n'
            : '';
        return text(preamble + spec);
      }),
  );

  server.registerTool(
    'validate_diagram',
    {
      title: 'Validate a diagram',
      description:
        'Check a diagram for problems: dangling connections, empty blocks, duplicate names, ' +
        'connections that do not make sense between those block types.',
      inputSchema: { diagram: diagramRef },
      annotations: { readOnlyHint: true },
    },
    async ({ diagram }) =>
      withDiagram(diagram, (d) => {
        const result = validateDiagram(d);
        if (!result.issues.length) return text(`"${d.name}" looks good — no issues found.`);
        const render = (label: string, items: typeof result.issues) =>
          items.length
            ? `\n**${label}**\n` +
              items.map((i) => `- ${i.message}${i.hint ? ` — _${i.hint}_` : ''}`).join('\n')
            : '';
        return text(
          `"${d.name}": ${result.errors.length} error(s), ${result.warnings.length} warning(s).` +
            render('Errors', result.errors) +
            render('Warnings', result.warnings) +
            render('Suggestions', result.info),
        );
      }),
  );

  server.registerTool(
    'export_diagram',
    {
      title: 'Export a diagram',
      description: 'Export a diagram as a Mermaid flowchart, a Markdown document, or raw JSON.',
      inputSchema: {
        diagram: diagramRef,
        format: z.enum(['mermaid', 'markdown', 'json']).optional().describe('Defaults to mermaid.'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ diagram, format = 'mermaid' }) =>
      withDiagram(diagram, (d) =>
        text(block(`"${d.name}" as ${format}:`, exportDiagram(d, format), format === 'json' ? 'json' : format)),
      ),
  );

  /* ================================================================ *
   * Creating
   * ================================================================ */

  server.registerTool(
    'create_diagram',
    {
      title: 'Create an empty diagram',
      description:
        'Create a new, empty diagram. Prefer create_diagram_from_outline when you already know ' +
        'what the project contains — it builds the whole thing in one call.',
      inputSchema: {
        name: z.string().describe('Diagram name, e.g. "Recipe sharing app".'),
        description: z.string().optional(),
        projectGoal: z.string().optional().describe('What the user wants to build, in a paragraph.'),
        techStack: techStackSchema.optional(),
        notes: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const { diagram } = await store.create(args);
        return text(`Created "${diagram.name}".\n\n${changeSummary(diagram, editorUrl)}`);
      } catch (err) {
        return fail(errorMessage(err));
      }
    },
  );

  server.registerTool(
    'create_diagram_from_outline',
    {
      title: 'Create a complete diagram',
      description:
        'Create a diagram together with all of its blocks and connections in one call, then lay it out. ' +
        'This is the tool to reach for when the user describes a project they want designed.\n\n' +
        'Connections may refer to blocks by name, so you can wire everything up in the same call.\n\n' +
        `Block types and the payload each one accepts:\n${allBlockTypesHint()}\n\n` +
        `Connection types:\n${allEdgeTypesHint()}`,
      inputSchema: {
        name: z.string(),
        description: z.string().optional(),
        projectGoal: z.string().optional().describe('What the user wants to build, in a paragraph.'),
        techStack: techStackSchema.optional(),
        notes: z.string().optional(),
        blocks: z.array(blockInputSchema).describe('Every block in the design.'),
        edges: z.array(edgeInputSchema).optional().describe('How the blocks relate.'),
        layoutDirection: z.enum(['LR', 'TB']).optional().describe('Defaults to LR.'),
      },
    },
    async (args) => {
      try {
        const { diagram: created } = await store.create({
          name: args.name,
          description: args.description,
          projectGoal: args.projectGoal,
          techStack: args.techStack,
          notes: args.notes,
        });
        const { diagram } = await store.update(created.slug, (draft) => {
          addBlocks(draft, args.blocks);
          addEdges(draft, args.edges ?? []);
          autoLayout(draft, { direction: args.layoutDirection ?? 'LR' });
        });
        return text(
          `Created "${diagram.name}" with ${diagram.blocks.length} blocks and ` +
            `${diagram.edges.length} connections.\n\n${changeSummary(diagram, editorUrl)}\n\n` +
            'Tell the user they can open that URL to review and edit the diagram.',
        );
      } catch (err) {
        return fail(errorMessage(err));
      }
    },
  );

  /* ================================================================ *
   * Editing
   * ================================================================ */

  server.registerTool(
    'add_blocks',
    {
      title: 'Add blocks',
      description:
        'Add one or more blocks to an existing diagram.\n\n' +
        `Payload fields per block type:\n${allBlockTypesHint()}`,
      inputSchema: {
        diagram: diagramRef,
        blocks: z.array(blockInputSchema),
        layout: z.boolean().optional().describe('Re-run auto-layout afterwards. Default true.'),
      },
    },
    async ({ diagram, blocks, layout = true }) =>
      mutate(diagram, (draft) => {
        const created = addBlocks(draft, blocks);
        if (layout) autoLayout(draft);
        return `Added ${created.length} block(s): ${created.map((b) => `${b.name} (${b.id})`).join(', ')}`;
      }),
  );

  server.registerTool(
    'update_block',
    {
      title: 'Update a block',
      description:
        'Change a block. `data` keys are merged over the existing payload, so you can fill in ' +
        'one field without resending the rest.\n\n' +
        BLOCK_TYPES.map((t) => `- ${t}: { ${blockDataHint(t)} }`).join('\n'),
      inputSchema: {
        diagram: diagramRef,
        block: blockRef,
        patch: blockPatchSchema,
      },
    },
    async ({ diagram, block: ref, patch }) =>
      mutate(diagram, (draft) => {
        const updated = updateBlock(draft, ref, patch);
        return `Updated "${updated.name}".`;
      }),
  );

  server.registerTool(
    'delete_blocks',
    {
      title: 'Delete blocks',
      description: 'Delete blocks and every connection attached to them.',
      inputSchema: { diagram: diagramRef, blocks: z.array(blockRef) },
      annotations: { destructiveHint: true },
    },
    async ({ diagram, blocks }) =>
      mutate(diagram, (draft) => {
        const result = deleteBlocks(draft, blocks);
        const missing = result.notFound.length ? ` Not found: ${result.notFound.join(', ')}.` : '';
        return `Deleted ${result.deletedBlocks.length} block(s) and ${result.deletedEdges.length} connection(s).${missing}`;
      }),
  );

  server.registerTool(
    'add_edges',
    {
      title: 'Connect blocks',
      description:
        `Connect blocks. Source and target may be block ids or names.\n\n${allEdgeTypesHint()}`,
      inputSchema: { diagram: diagramRef, edges: z.array(edgeInputSchema) },
    },
    async ({ diagram, edges }) =>
      mutate(diagram, (draft) => {
        const created = addEdges(draft, edges);
        return `Added ${created.length} connection(s).`;
      }),
  );

  server.registerTool(
    'update_edge',
    {
      title: 'Update a connection',
      description: 'Change a connection\'s type, label, condition or endpoints.',
      inputSchema: {
        diagram: diagramRef,
        edge: z.string().describe('Connection id.'),
        patch: z.object({
          type: edgeTypeEnum.optional(),
          label: z.string().optional(),
          description: z.string().optional(),
          condition: z.string().optional(),
          source: z.string().optional(),
          target: z.string().optional(),
        }),
      },
    },
    async ({ diagram, edge, patch }) =>
      mutate(diagram, (draft) => {
        updateEdge(draft, edge, patch);
        return `Updated connection ${edge}.`;
      }),
  );

  server.registerTool(
    'delete_edges',
    {
      title: 'Delete connections',
      description: 'Remove connections by id.',
      inputSchema: { diagram: diagramRef, edges: z.array(z.string()) },
      annotations: { destructiveHint: true },
    },
    async ({ diagram, edges }) =>
      mutate(diagram, (draft) => `Deleted ${deleteEdges(draft, edges).length} connection(s).`),
  );

  server.registerTool(
    'apply_batch',
    {
      title: 'Apply many changes at once',
      description:
        'Apply an ordered list of changes in a single save. Later operations can refer to blocks ' +
        'created by earlier ones by name, which makes this the efficient way to restructure a diagram.',
      inputSchema: {
        diagram: diagramRef,
        operations: z.array(batchOperationSchema),
        layout: z.boolean().optional().describe('Re-run auto-layout afterwards. Default false.'),
      },
    },
    async ({ diagram, operations, layout = false }) =>
      mutate(diagram, (draft) => {
        const result = applyBatch(draft, operations as BatchOperation[]);
        if (layout) autoLayout(draft);
        const failures = result.errors.length
          ? `\nFailed: ${result.errors.map((e) => `#${e.index} ${e.op} — ${e.message}`).join('; ')}`
          : '';
        return `Applied ${result.applied} of ${operations.length} operation(s).${failures}`;
      }),
  );

  server.registerTool(
    'move_blocks',
    {
      title: 'Move blocks',
      description: 'Set the canvas position of one or more blocks.',
      inputSchema: {
        diagram: diagramRef,
        moves: z.array(z.object({ block: blockRef, x: z.number(), y: z.number() })),
      },
    },
    async ({ diagram, moves }) =>
      mutate(diagram, (draft) => `Moved ${moveBlocks(draft, moves).length} block(s).`),
  );

  server.registerTool(
    'auto_layout',
    {
      title: 'Tidy the layout',
      description: 'Re-position every block into dependency-ordered layers.',
      inputSchema: {
        diagram: diagramRef,
        direction: z.enum(['LR', 'TB']).optional().describe('Defaults to LR.'),
      },
    },
    async ({ diagram, direction = 'LR' }) =>
      mutate(diagram, (draft) => {
        autoLayout(draft, { direction });
        return `Laid out ${draft.blocks.length} block(s) ${direction === 'LR' ? 'left to right' : 'top to bottom'}.`;
      }),
  );

  server.registerTool(
    'update_diagram_meta',
    {
      title: 'Update diagram details',
      description: 'Change the name, description, goal, tech stack or notes of a diagram.',
      inputSchema: {
        diagram: diagramRef,
        name: z.string().optional(),
        description: z.string().optional(),
        projectGoal: z.string().optional(),
        techStack: techStackSchema.optional(),
        notes: z.string().optional(),
      },
    },
    async ({ diagram, name, ...rest }) => {
      try {
        if (name) await store.rename(diagram, name);
        const target = name ?? diagram;
        const { diagram: saved } = await store.update(target, (draft) => {
          if (rest.description !== undefined) draft.description = rest.description;
          if (rest.projectGoal !== undefined) draft.projectGoal = rest.projectGoal;
          if (rest.notes !== undefined) draft.notes = rest.notes;
          if (rest.techStack) draft.techStack = { ...draft.techStack, ...rest.techStack };
        });
        return text(`Updated details.\n\n${changeSummary(saved, editorUrl)}`);
      } catch (err) {
        return fail(errorMessage(err));
      }
    },
  );

  server.registerTool(
    'delete_diagram',
    {
      title: 'Delete a diagram',
      description: 'Permanently delete a diagram file. Ask the user before calling this.',
      inputSchema: { diagram: diagramRef },
      annotations: { destructiveHint: true },
    },
    async ({ diagram }) => {
      try {
        const result = await store.delete(diagram);
        return text(`Deleted ${result.file}.`);
      } catch (err) {
        return fail(errorMessage(err));
      }
    },
  );

  /* ================================================================ *
   * Lifecycle and implementation
   * ================================================================ */

  server.registerTool(
    'set_diagram_status',
    {
      title: 'Set diagram status',
      description:
        'Move a diagram between "draft" (still being designed), "ready" (the user has approved it ' +
        'and it can be implemented) and "implemented". Only set "ready" when the user says so.',
      inputSchema: {
        diagram: diagramRef,
        status: z.enum(['draft', 'ready', 'implemented']),
      },
    },
    async ({ diagram, status }) =>
      mutate(diagram, (draft) => {
        draft.status = status;
        return `Status set to ${status}.`;
      }),
  );

  server.registerTool(
    'mark_block_implemented',
    {
      title: 'Record implementation progress',
      description:
        'Record that a block has been built, and which files implement it. Call this as you work ' +
        'through the spec so the user sees progress on the canvas.',
      inputSchema: {
        diagram: diagramRef,
        block: blockRef,
        status: z.enum(['todo', 'in_progress', 'done', 'blocked']).optional().describe('Defaults to done.'),
        files: z.array(z.string()).optional().describe('Paths relative to the project root.'),
        notes: z.string().optional().describe('Anything that differed from the design.'),
        appendFiles: z.boolean().optional().describe('Add to the existing file list instead of replacing it.'),
      },
    },
    async ({ diagram, ...input }) =>
      mutate(diagram, (draft) => {
        const updated = markImplemented(draft, input);
        return `"${updated.name}" is now ${updated.implementation.status}` +
          `${updated.implementation.files.length ? ` (${updated.implementation.files.join(', ')})` : ''}.`;
      }),
  );

  server.registerTool(
    'implementation_progress',
    {
      title: 'Implementation progress',
      description: 'Show how much of a diagram has been built, and what is left in build order.',
      inputSchema: { diagram: diagramRef },
      annotations: { readOnlyHint: true },
    },
    async ({ diagram }) =>
      withDiagram(diagram, (d) => {
        const stats = diagramStats(d);
        const order = buildOrder(d);
        const remaining = order.order.filter(
          (b) => b.type !== 'note' && b.implementation.status !== 'done',
        );
        return text(
          [
            `**${d.name}** — ${stats.completion}% built ` +
              `(${stats.implemented} done, ${stats.inProgress} in progress, ${stats.todo} to do).`,
            remaining.length ? '\n**Next, in build order:**' : '\nEverything is implemented.',
            ...remaining
              .slice(0, 25)
              .map((b) => `- ${b.name} (${b.type})${b.implementation.status === 'blocked' ? ' — blocked' : ''}`),
          ].join('\n'),
        );
      }),
  );

  server.registerTool(
    'open_editor',
    {
      title: 'Open the editor',
      description:
        'Return the URL where the user can review and edit a diagram visually, and how to start ' +
        'the editor if it is not running.',
      inputSchema: { diagram: diagramRef.optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ diagram }) => {
      const suffix = diagram ? `/d/${(await store.read(diagram).catch(() => null))?.slug ?? diagram}` : '';
      return text(
        `Open ${editorUrl}${suffix} to review the diagram.\n\n` +
          'If nothing is listening there, the user can start the editor with `npx dgp` in the project root.',
      );
    },
  );

  /* ================================================================ *
   * Resources and prompts
   * ================================================================ */

  server.registerResource(
    'diagrams',
    'diagram://index',
    {
      title: 'All diagrams',
      description: 'The list of diagrams in this project.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const list = await store.list();
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(list, null, 2) }],
      };
    },
  );

  server.registerPrompt(
    'design_project',
    {
      title: 'Design a project as a diagram',
      description: 'Turn a project idea into a diagram-plus block diagram.',
      argsSchema: { idea: z.string().describe('What the user wants to build.') },
    },
    ({ idea }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Design this project as a diagram-plus block diagram:\n\n${idea}\n`,
              'Work like this:',
              '1. Call describe_block_schema so you know every field available.',
              '2. Decide the data models first, then the services, endpoints and screens.',
              '3. Call create_diagram_from_outline once, with every block and connection, filling in',
              '   real field names, parameters and pseudo-code steps — not placeholders.',
              '4. Tell me the editor URL so I can review and edit it.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'implement_from_diagram',
    {
      title: 'Implement a project from its diagram',
      description: 'Read a diagram and build the project it describes.',
      argsSchema: { diagram: z.string().describe('Diagram slug, id or name.') },
    },
    ({ diagram }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Build the project described by the "${diagram}" diagram.`,
              '',
              '1. Call read_implementation_spec to get the full specification.',
              '2. Follow its build order — configuration and data models first, screens last.',
              '3. Implement each block exactly as specified: the field names, routes, parameters and',
              '   steps in the diagram are the contract. If something is genuinely missing, ask me',
              '   rather than inventing it.',
              '4. After each block is written, call mark_block_implemented with the files you created.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  return server;
}
