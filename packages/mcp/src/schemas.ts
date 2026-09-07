import { z } from 'zod';
import { BLOCK_TYPES, EDGE_TYPES } from '@diagram-plus/core';

/**
 * Argument schemas shared by several tools.
 *
 * `data` is intentionally an open record: the per-type payload is validated by
 * core when the block is built, and the tool descriptions carry the field list,
 * so the wire schema stays small enough to read.
 */

export const diagramRef = z
  .string()
  .describe('Diagram to act on: its slug, id, or exact name.');

export const blockRef = z
  .string()
  .describe('Block to act on: its id or its exact name within the diagram.');

export const blockTypeEnum = z.enum(BLOCK_TYPES);
export const edgeTypeEnum = z.enum(EDGE_TYPES);

export const positionSchema = z
  .object({ x: z.number(), y: z.number() })
  .describe('Canvas position. Omit and let auto-layout place the block.');

export const blockInputSchema = z.object({
  type: blockTypeEnum.describe('Which kind of block this is.'),
  name: z.string().describe('Short, unique name. Becomes the identifier in code.'),
  summary: z.string().optional().describe('One line shown on the block in the editor.'),
  description: z.string().optional().describe('Longer explanation.'),
  tags: z.array(z.string()).optional(),
  position: positionSchema.optional(),
  data: z
    .record(z.any())
    .optional()
    .describe('Type-specific payload. See the field list for this block type.'),
});

export const edgeInputSchema = z.object({
  source: z.string().describe('Id or name of the block the connection starts at.'),
  target: z.string().describe('Id or name of the block the connection points at.'),
  type: edgeTypeEnum.optional().describe('Relationship type. Defaults to "calls".'),
  label: z.string().optional(),
  description: z.string().optional(),
  condition: z.string().optional().describe('For conditional connections: when this path is taken.'),
});

export const techStackSchema = z.object({
  language: z.string().optional(),
  frontend: z.string().optional(),
  backend: z.string().optional(),
  database: z.string().optional(),
  packages: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export const blockPatchSchema = z.object({
  name: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  position: positionSchema.optional(),
  data: z
    .record(z.any())
    .optional()
    .describe('Payload keys to change. Merged over the existing payload; arrays replace wholesale.'),
  replaceData: z
    .boolean()
    .optional()
    .describe('Replace the whole payload instead of merging.'),
});

export const batchOperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add_block'), block: blockInputSchema }),
  z.object({ op: z.literal('update_block'), block: blockRef, patch: blockPatchSchema }),
  z.object({ op: z.literal('delete_block'), block: blockRef }),
  z.object({ op: z.literal('add_edge'), edge: edgeInputSchema }),
  z.object({
    op: z.literal('update_edge'),
    edge: z.string(),
    patch: z.object({
      type: edgeTypeEnum.optional(),
      label: z.string().optional(),
      description: z.string().optional(),
      condition: z.string().optional(),
      source: z.string().optional(),
      target: z.string().optional(),
    }),
  }),
  z.object({ op: z.literal('delete_edge'), edge: z.string() }),
  z.object({ op: z.literal('move_block'), block: blockRef, x: z.number(), y: z.number() }),
  z.object({
    op: z.literal('add_group'),
    group: z.object({ name: z.string(), description: z.string().optional(), color: z.string().optional() }),
  }),
  z.object({ op: z.literal('delete_group'), group: z.string() }),
  z.object({ op: z.literal('set_status'), status: z.enum(['draft', 'ready', 'implemented']) }),
]);

export type BlockInputArg = z.infer<typeof blockInputSchema>;
export type EdgeInputArg = z.infer<typeof edgeInputSchema>;

/**
 * Edits to the client view — the plain-language document a client is shown and
 * edits during a review. Boxes are addressed by name or by id, because whoever
 * is asking for the change is reading the names.
 */
const clientBranchSchema = z.object({
  label: z.string().describe('What this outcome is called, e.g. "declined".'),
  when: z.string().optional().describe('When it happens, e.g. "the card was declined".'),
});

export const clientNodeRef = z
  .string()
  .describe('Box to act on: its exact name in the client view, or its id.');

export const clientViewOperationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add_node'),
    name: z.string().describe('What the client calls it. Plain language, no jargon.'),
    type: blockTypeEnum
      .optional()
      .describe('What it really is. Defaults to ui_screen; use note when it is not decided yet.'),
    description: z.string().optional().describe('One supporting line under the name.'),
    condition: z.string().optional().describe('For a decision: the question being asked.'),
    branches: z.array(clientBranchSchema).optional().describe('For a decision: the outcomes.'),
    note: z.string().optional().describe('What the client actually said, kept verbatim.'),
    after: clientNodeRef.optional().describe('Put it after this box in the walkthrough.'),
  }),
  z.object({
    op: z.literal('update_node'),
    node: clientNodeRef,
    name: z.string().optional(),
    type: blockTypeEnum.optional(),
    description: z.string().optional(),
    condition: z.string().optional(),
    branches: z.array(clientBranchSchema).optional(),
    note: z.string().optional(),
  }),
  z.object({ op: z.literal('remove_node'), node: clientNodeRef }),
  z.object({
    op: z.literal('add_edge'),
    source: clientNodeRef,
    target: clientNodeRef,
    type: edgeTypeEnum.optional().describe('Defaults to navigation — "this leads to that".'),
    label: z.string().optional(),
    condition: z.string().optional().describe('When this path is taken.'),
  }),
  z.object({ op: z.literal('remove_edge'), source: clientNodeRef, target: clientNodeRef }),
  z.object({
    op: z.literal('reorder'),
    order: z
      .array(clientNodeRef)
      .describe('The walkthrough order. Boxes left out keep their place at the end.'),
  }),
  z.object({
    op: z.literal('set_notes'),
    notes: z.string().describe('Free text from the review, kept with the view.'),
  }),
]);
