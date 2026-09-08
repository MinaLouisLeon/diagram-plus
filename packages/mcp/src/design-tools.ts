import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  DesignStore,
  DiagramStore,
  designProgress,
  describeSchemaError,
  diffDesign,
  editDesign,
  layoutDesign,
  reconcileDesign,
  renderDesign,
  renderDesignSystem,
  renderScreenOutline,
  type DesignDocument,
  type DesignOperation,
  type Diagram,
  type ElementType,
} from '@diagram-plus/core';
import {
  DESIGN_EXAMPLE,
  DESIGN_RULES,
  allElementTypesHint,
  designCatalogJson,
} from './design-hints.js';
import {
  designOperationSchema,
  designSystemSchema,
  deviceEnum,
  elementTreeSchema,
  elementTypeEnum,
  screenRef,
  screenStateSchema,
} from './design-schemas.js';
import { diagramRef } from './schemas.js';

/**
 * The screen-design tools.
 *
 * The third document gets the same treatment as the other two: read it, edit
 * it in one vocabulary, bring it back into line with the diagram. What is
 * different is who does the drawing. A client view is something a person fills
 * in during a meeting; a screen design is something a model can do well and a
 * person mostly wants to adjust — so `design_screen` takes a whole tree in one
 * call, and the editor is where it gets nudged afterwards.
 */

export interface DesignToolOptions {
  store: DiagramStore;
  designs: DesignStore;
  editorUrl: string;
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

/**
 * Put what was silently put right in front of the caller.
 *
 * An edit that was applied but quietly corrected is the case where saying
 * nothing costs the most: the model believes it drew what it sent, carries on
 * the same way for the next fifteen screens, and the person who finds out is
 * the client looking at the canvas.
 */
function noteCorrections(corrections: string[]): string[] {
  if (!corrections.length) return [];
  return [['**Corrected on the way in**', ...corrections.map((c) => `- ${c}`)].join('\n')];
}

export function registerDesignTools(server: McpServer, options: DesignToolOptions): void {
  const { store, designs, editorUrl } = options;

  /** Load the diagram and its designs together — one is meaningless alone. */
  async function withDesign(
    ref: string,
    fn: (diagram: Diagram, design: DesignDocument) => ToolResult | Promise<ToolResult>,
  ): Promise<ToolResult> {
    try {
      const diagram = await store.read(ref);
      return await fn(diagram, await designs.ensure(diagram));
    } catch (err) {
      return fail(describeSchemaError(err));
    }
  }

  /** Load, mutate, save — with the standard summary and error handling. */
  async function mutate(
    ref: string,
    mutator: (design: DesignDocument, diagram: Diagram) => string | void,
    options: { seed?: boolean } = {},
  ): Promise<ToolResult> {
    try {
      const diagram = await store.read(ref);
      let note = '';
      const { document } = await designs.update(
        diagram,
        (draft) => {
          note = mutator(draft, diagram) ?? '';
        },
        options,
      );
      return text([note, summary(diagram, document)].filter(Boolean).join('\n\n'));
    } catch (err) {
      return fail(describeSchemaError(err));
    }
  }

  /** One-line state of the designs, appended after every change. */
  function summary(diagram: Diagram, design: DesignDocument): string {
    const progress = designProgress(diagram, design);
    const changes = diffDesign(diagram, design);
    const lines = [
      `"${diagram.name}" designs are at revision ${design.revision}: ${progress.screens} screen(s), ` +
        `${progress.elements} elements, ${progress.completion}% of the UI blocks designed.`,
    ];
    if (changes.undesigned.length) {
      lines.push(
        `Not designed yet: ${changes.undesigned.map((b) => b.name).join(', ')}. ` +
          'Run sync_screen_designs to seed them from the diagram.',
      );
    }
    if (progress.danglingActions.length) {
      lines.push(
        `${progress.danglingActions.length} button(s) neither call anything nor go anywhere: ` +
          progress.danglingActions
            .slice(0, 5)
            .map((d) => `${d.screen} → ${d.element}`)
            .join(', '),
      );
    }
    if (progress.unboundFields.length) {
      lines.push(
        `${progress.unboundFields.length} field(s) with no binding: ` +
          progress.unboundFields
            .slice(0, 5)
            .map((d) => `${d.screen} → ${d.element}`)
            .join(', '),
      );
    }
    lines.push(`The user reviews this at ${editorUrl}/d/${diagram.slug} — the Design tab.`);
    return lines.join('\n');
  }

  /* ================================================================ *
   * Discovery
   * ================================================================ */

  server.registerTool(
    'describe_design_schema',
    {
      title: 'Describe the design vocabulary',
      description:
        'List every element type a screen can hold, with the properties each one uses, its ' +
        'defaults, and the full layout and style vocabulary. Call this before designing a screen ' +
        'if you are unsure which element fits or what a property is called.\n\n' +
        `The elements:\n${allElementTypesHint()}`,
      inputSchema: {
        elementType: elementTypeEnum.optional().describe('Limit the answer to one element type.'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ elementType }) =>
      text(
        block(
          elementType
            ? `Schema for the "${elementType}" element:`
            : 'The diagram-plus design vocabulary:',
          JSON.stringify(designCatalogJson(elementType as ElementType | undefined), null, 2),
        ) + `\n\nHow to design a screen:\n${DESIGN_RULES}\n\nA worked example:\n\n\`\`\`json\n${DESIGN_EXAMPLE}\n\`\`\``,
      ),
  );

  /* ================================================================ *
   * Reading
   * ================================================================ */

  server.registerTool(
    'read_screen_design',
    {
      title: 'Read the screen designs',
      description:
        'Read what the screens look like: every element, its words, where its value comes from ' +
        'and what using it does. Read this before implementing any screen — the diagram says ' +
        'what the screen is for, this says what to build.\n\n' +
        'With no screen named it returns the design system and every screen. Name one to get ' +
        'just that screen.',
      inputSchema: {
        diagram: diagramRef,
        screen: screenRef.optional().describe('Just this screen. Omit for all of them.'),
        json: z
          .boolean()
          .optional()
          .describe('Return the raw element tree as JSON as well — for editing it precisely.'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ diagram, screen, json = false }) =>
      withDesign(diagram, (d, design) => {
        if (!design.screens.length) {
          return text(
            `"${d.name}" has no screens designed yet.\n\n` +
              'Run sync_screen_designs to seed one wireframe per ui_screen block from the ' +
              'diagram — each already carrying its fields and its buttons — then refine them ' +
              'with design_screen.',
          );
        }

        if (!screen) {
          return text(
            renderDesign(design) +
              '\n' +
              summary(d, design),
          );
        }

        const needle = screen.trim().toLowerCase();
        const found =
          design.screens.find((s) => s.id === screen.trim()) ??
          design.screens.find((s) => `${s.name} / ${s.variant}`.toLowerCase() === needle) ??
          design.screens.find((s) => s.name.toLowerCase() === needle) ??
          design.screens.find((s) => s.blockId === screen.trim());
        if (!found) {
          return fail(
            `No screen matching "${screen}". This design has: ` +
              design.screens.map((s) => (s.variant ? `${s.name} / ${s.variant}` : s.name)).join(', '),
          );
        }

        const parts = [
          `## ${found.variant ? `${found.name} — ${found.variant}` : found.name}`,
          '',
          renderScreenOutline(found),
          '',
          '### Design system',
          '',
          renderDesignSystem(design.system),
        ];
        if (json) {
          parts.push('', block('The element tree:', JSON.stringify(found.root, null, 2)));
        }
        return text(parts.join('\n'));
      }),
  );

  server.registerTool(
    'design_progress',
    {
      title: 'What is designed and what is not',
      description:
        'How much of the interface has been designed: which ui_screen blocks still have no ' +
        'design, which screens are drafted or approved, and the holes worth chasing — buttons ' +
        'that do nothing and fields with nowhere to put their value.',
      inputSchema: { diagram: diagramRef },
      annotations: { readOnlyHint: true },
    },
    async ({ diagram }) =>
      withDesign(diagram, (d, design) => {
        const progress = designProgress(d, design);
        const changes = diffDesign(d, design);
        const lines = [
          `**${d.name}** — ${progress.completion}% of the UI designed.`,
          '',
          `- ${progress.screens} artboards: ${progress.todo} untouched, ${progress.drafted} drafted, ${progress.approved} approved`,
          `- ${progress.elements} elements in total`,
        ];
        if (changes.undesigned.length) {
          lines.push(
            '',
            '**No design yet**',
            ...changes.undesigned.map((b) => `- ${b.name} (${b.type})`),
          );
        }
        if (changes.orphaned.length) {
          lines.push(
            '',
            '**Designed, but the block has gone from the diagram**',
            ...changes.orphaned.map((s) => `- ${s.name}`),
          );
        }
        if (progress.danglingActions.length) {
          lines.push(
            '',
            '**Buttons that neither call anything nor go anywhere**',
            ...progress.danglingActions.map((d2) => `- ${d2.screen} → ${d2.element}`),
          );
        }
        if (progress.unboundFields.length) {
          lines.push(
            '',
            '**Fields with no binding**',
            ...progress.unboundFields.map((d2) => `- ${d2.screen} → ${d2.element}`),
          );
        }
        return text(lines.join('\n'));
      }),
  );

  /* ================================================================ *
   * Designing
   * ================================================================ */

  server.registerTool(
    'design_screen',
    {
      title: 'Design a screen',
      description:
        'Draw a screen: pass its whole layout as one nested element tree. This is the main tool ' +
        'for designing — write the screen in one call rather than adding elements one at a ' +
        'time.\n\n' +
        'The screen may already exist (seeded from its ui_screen block by sync_screen_designs), ' +
        'in which case its tree is replaced; name a block that has no design and one is created ' +
        'for it.\n\n' +
        `Rules:\n${DESIGN_RULES}\n\n` +
        `The elements:\n${allElementTypesHint()}\n\n` +
        `Example \`root\`:\n${DESIGN_EXAMPLE}`,
      inputSchema: {
        diagram: diagramRef,
        screen: screenRef,
        root: elementTreeSchema.describe('The whole layout of the screen, as one nested element.'),
        variant: z
          .string()
          .optional()
          .describe(
            'Design a second artboard for the same screen — "Empty", "Error", "Signed out". ' +
              'Creates it if it is not there.',
          ),
        device: deviceEnum.optional(),
        purpose: z.string().optional().describe('One line on what the screen is for.'),
        states: z
          .array(screenStateSchema)
          .optional()
          .describe(
            'States not worth their own artboard: what changes while it loads, when it is ' +
              'empty, when it fails. These reach the implementation spec.',
          ),
        notes: z.string().optional().describe('Anything the implementer needs that the tree cannot say.'),
      },
    },
    async ({ diagram, screen, root, variant, device, purpose, states, notes }) =>
      mutate(diagram, (design, d) => {
        const needle = screen.trim().toLowerCase();
        const target = variant
          ? design.screens.find(
              (s) =>
                s.variant.toLowerCase() === variant.trim().toLowerCase() &&
                (s.name.toLowerCase() === needle || s.id === screen.trim() || s.blockId === screen.trim()),
            )
          : design.screens.find(
              (s) =>
                (s.id === screen.trim() ||
                  s.name.toLowerCase() === needle ||
                  s.blockId === screen.trim()) &&
                !s.variant,
            );

        const operations: DesignOperation[] = [];
        if (target) {
          operations.push({ op: 'set_tree', screen: target.id, root });
          operations.push({
            op: 'update_screen',
            screen: target.id,
            status: 'drafted',
            ...(device ? { device } : {}),
            ...(purpose !== undefined ? { purpose } : {}),
            ...(states ? { states: states.map(normalizeState) } : {}),
            ...(notes !== undefined ? { notes } : {}),
          });
        } else {
          // Nothing to replace: this is a new artboard. Link it to the block
          // if the reference named one, so it still tracks the diagram.
          const linked = d.blocks.find(
            (b) => b.id === screen.trim() || b.name.toLowerCase() === needle,
          );
          operations.push({
            op: 'add_screen',
            name: linked?.name ?? screen.trim(),
            blockId: linked?.id ?? null,
            variant: variant ?? '',
            purpose: purpose ?? '',
            device,
            root,
            states: states?.map(normalizeState),
          });
          if (notes !== undefined) {
            operations.push({
              op: 'update_screen',
              screen: variant ? `${linked?.name ?? screen.trim()} / ${variant}` : (linked?.name ?? screen.trim()),
              status: 'drafted',
              notes,
            });
          }
        }

        const result = editDesign(design, operations);
        Object.assign(design, result.document);

        if (result.errors.length) {
          return [
            `Could not design "${screen}":`,
            ...result.errors.map((e) => `  ${e.op}: ${e.message}`),
          ].join('\n');
        }

        const drawn = result.document.screens.find(
          (s) =>
            (s.id === target?.id) ||
            (s.name.toLowerCase() === (target?.name.toLowerCase() ?? needle) &&
              s.variant === (variant ?? '')),
        );
        const headline = drawn
          ? `Designed **${drawn.variant ? `${drawn.name} — ${drawn.variant}` : drawn.name}**.\n\n${renderScreenOutline(drawn)}`
          : `Designed "${screen}".`;
        // The corrections go after the outline, because the outline is what
        // actually landed — the tree as it now is, not the tree as it was sent.
        return [headline, ...noteCorrections(result.corrections)].join('\n\n');
      }),
  );

  server.registerTool(
    'update_screen_design',
    {
      title: 'Edit the screen designs',
      description:
        'Make precise changes to the designs: add or retype one element, rebind a field, move ' +
        'something into a different container, add an artboard for the empty state, reorder the ' +
        'screens. Use design_screen to draw a whole screen; use this to adjust one.\n\n' +
        `The elements:\n${allElementTypesHint()}`,
      inputSchema: {
        diagram: diagramRef,
        operations: z
          .array(designOperationSchema)
          .min(1)
          .describe('Edits, applied in order. Later ones can refer to what earlier ones added.'),
      },
    },
    async ({ diagram, operations }) =>
      mutate(diagram, (design) => {
        const result = editDesign(design, operations as unknown as DesignOperation[]);
        Object.assign(design, result.document);
        const lines = [`Applied ${result.applied} of ${operations.length} edit(s) to the designs.`];
        if (result.errors.length) {
          lines.push(...result.errors.map((e) => `  operation ${e.index} (${e.op}): ${e.message}`));
        }
        return [lines.join('\n'), ...noteCorrections(result.corrections)].join('\n\n');
      }),
  );

  server.registerTool(
    'set_design_system',
    {
      title: 'Set the design system',
      description:
        'Define the tokens every screen is drawn against: the colours, the type scale, the ' +
        'spacing step, the corner radii. Do this **first**, before designing any screen, and ' +
        'design against the names — a screen that refers to `accent` and `heading.lg` can be ' +
        'restyled in one edit, one that refers to `#2563eb` cannot.\n\n' +
        'Each list you pass replaces that list wholesale; lists you leave out are untouched. A ' +
        'sensible neutral set is already in place, so you can change only what matters.',
      inputSchema: { diagram: diagramRef, system: designSystemSchema },
    },
    async ({ diagram, system }) =>
      mutate(diagram, (design) => {
        const result = editDesign(design, [
          { op: 'set_system', system: system as never },
        ]);
        Object.assign(design, result.document);
        if (result.errors.length) return `Could not set the design system: ${result.errors[0]?.message}`;
        return `Design system updated.\n\n${renderDesignSystem(result.document.system)}`;
      }),
  );

  /* ================================================================ *
   * Keeping in step with the diagram
   * ================================================================ */

  server.registerTool(
    'sync_screen_designs',
    {
      title: 'Seed designs from the diagram',
      description:
        'Give every ui_screen and ui_component block a design, seeded from what the block ' +
        'already says: a header with its name, a field per piece of its state (already bound), ' +
        'a button per action (already pointing at the endpoint it calls). The result is a ' +
        'wireframe of the right thing with every hook wired — start here, then refine each ' +
        'screen with design_screen.\n\n' +
        'Screens already drawn are kept: their wording, their layout, their elements. A screen ' +
        'whose block has been deleted is flagged, never removed.',
      inputSchema: {
        diagram: diagramRef,
        rebuild: z
          .boolean()
          .optional()
          .describe(
            'Throw every design away and re-seed from scratch. Loses all design work — the ' +
              'tokens survive, nothing else does. Ask first.',
          ),
        layout: z.boolean().optional().describe('Re-arrange the artboards into a grid afterwards.'),
      },
    },
    async ({ diagram, rebuild = false, layout = false }) =>
      mutate(
        diagram,
        (design, d) => {
          const base = rebuild ? { ...design, screens: [] } : design;
          const result = reconcileDesign(d, base);
          Object.assign(
            design,
            layout ? layoutDesign(result.document, { includePinned: true }) : result.document,
          );

          const lines = [
            rebuild
              ? `Re-seeded every design from the diagram: ${result.document.screens.length} screen(s).`
              : `Designs are up to date: ${result.document.screens.length} screen(s).`,
          ];
          if (result.added.length) {
            lines.push(`  seeded from the diagram: ${result.added.join(', ')}`);
          }
          if (result.updated.length) {
            lines.push(`  refreshed from the diagram: ${result.updated.join(', ')}`);
          }
          if (result.orphaned.length) {
            lines.push(`  their block has gone: ${result.orphaned.join(', ')}`);
          }
          lines.push(
            '',
            'These are wireframes, not finished screens. Work through them with design_screen — ' +
              'the arrangement, the real words, the states — and set the tokens first with ' +
              'set_design_system if you have not.',
          );
          return lines.join('\n');
        },
        // Start from what is on disk, not from a fresh derivation: reconciling
        // against an already-derived document would find every screen already
        // present and report that it had seeded nothing.
        { seed: false },
      ),
  );

  server.registerTool(
    'arrange_screen_designs',
    {
      title: 'Tidy the design canvas',
      description:
        'Lay the artboards out in a grid in walkthrough order. Cosmetic — it changes where the ' +
        'screens sit on the canvas, never what is on them.',
      inputSchema: {
        diagram: diagramRef,
        includeMoved: z
          .boolean()
          .optional()
          .describe('Move artboards the user has dragged too. Off by default.'),
      },
    },
    async ({ diagram, includeMoved = false }) =>
      mutate(diagram, (design) => {
        Object.assign(design, layoutDesign(design, { includePinned: includeMoved }));
        return `Arranged ${design.screens.length} artboard(s).`;
      }),
  );
}

/** Fill the optional halves of a screen state so it satisfies the schema. */
function normalizeState(state: { name: string; when?: string; changes?: string }) {
  return { name: state.name, when: state.when ?? '', changes: state.changes ?? '' };
}
