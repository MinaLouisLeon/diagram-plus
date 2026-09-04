import { z } from 'zod';
import { FieldSchema } from './common.js';
import type { BlockType } from './blocks.js';

/**
 * Typed connections. The type is not decoration: `calls` and `writes` mean
 * different things when the diagram is turned into code, and the validator uses
 * them to flag connections that cannot be right (a data model cannot "navigate"
 * to a screen).
 */

export const EDGE_TYPES = [
  'calls',
  'data_flow',
  'navigation',
  'renders',
  'reads',
  'writes',
  'emits',
  'listens',
  'depends_on',
  'conditional',
  'error_flow',
] as const;

export const EdgeTypeSchema = z.enum(EDGE_TYPES);
export type EdgeType = z.infer<typeof EdgeTypeSchema>;

export const EdgeSchema = z.object({
  id: z.string().min(1),
  type: EdgeTypeSchema.default('calls'),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().nullable().default(null),
  targetHandle: z.string().nullable().default(null),
  label: z.string().default(''),
  description: z.string().default(''),
  /** Guard for `conditional` edges, e.g. "cart is empty". */
  condition: z.string().default(''),
  /** Shape of the data travelling along a `data_flow` edge. */
  payload: z.array(FieldSchema).default([]),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
});

export type Edge = z.infer<typeof EdgeSchema>;
export type EdgeInput = z.input<typeof EdgeSchema>;

export interface EdgeTypeInfo {
  type: EdgeType;
  label: string;
  description: string;
  /** Rendering hint for the editor. */
  style: 'solid' | 'dashed' | 'dotted';
  /** Source block types this edge normally starts from. `null` = anything. */
  validSources: readonly BlockType[] | null;
  /** Target block types this edge normally points at. `null` = anything. */
  validTargets: readonly BlockType[] | null;
}

const CODE_BLOCKS = [
  'service',
  'function',
  'api_endpoint',
  'job',
  'ui_screen',
  'ui_component',
] as const;

export const EDGE_TYPE_INFO: Record<EdgeType, EdgeTypeInfo> = {
  calls: {
    type: 'calls',
    label: 'calls',
    description: 'Source invokes the target and waits for a result.',
    style: 'solid',
    validSources: CODE_BLOCKS,
    validTargets: [
      'service',
      'function',
      'api_endpoint',
      'external_service',
      'job',
    ],
  },
  data_flow: {
    type: 'data_flow',
    label: 'data',
    description: 'Data moves from source to target.',
    style: 'solid',
    validSources: null,
    validTargets: null,
  },
  navigation: {
    type: 'navigation',
    label: 'navigates to',
    description: 'The user moves from one screen to another.',
    style: 'solid',
    validSources: ['ui_screen', 'ui_component'],
    validTargets: ['ui_screen'],
  },
  renders: {
    type: 'renders',
    label: 'renders',
    description: 'A screen or component renders another component.',
    style: 'solid',
    validSources: ['ui_screen', 'ui_component'],
    validTargets: ['ui_component'],
  },
  reads: {
    type: 'reads',
    label: 'reads',
    description: 'Source reads from a data model or datastore.',
    style: 'dashed',
    validSources: CODE_BLOCKS,
    validTargets: ['data_model', 'datastore', 'config'],
  },
  writes: {
    type: 'writes',
    label: 'writes',
    description: 'Source creates, updates or deletes stored data.',
    style: 'dashed',
    validSources: CODE_BLOCKS,
    validTargets: ['data_model', 'datastore'],
  },
  emits: {
    type: 'emits',
    label: 'emits',
    description: 'Source publishes an event.',
    style: 'dotted',
    validSources: CODE_BLOCKS,
    validTargets: ['event'],
  },
  listens: {
    type: 'listens',
    label: 'listens to',
    description: 'Target consumes an event produced elsewhere.',
    style: 'dotted',
    validSources: ['event'],
    validTargets: ['service', 'function', 'job', 'ui_screen', 'ui_component'],
  },
  depends_on: {
    type: 'depends_on',
    label: 'depends on',
    description: 'Source needs the target to exist before it can work.',
    style: 'dashed',
    validSources: null,
    validTargets: null,
  },
  conditional: {
    type: 'conditional',
    label: 'if',
    description: 'Flow taken only when the edge condition holds.',
    style: 'solid',
    validSources: ['decision', 'loop', 'function', 'service', 'job'],
    validTargets: null,
  },
  error_flow: {
    type: 'error_flow',
    label: 'on error',
    description: 'Path taken when the source fails.',
    style: 'dotted',
    validSources: null,
    validTargets: null,
  },
};
