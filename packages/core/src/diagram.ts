import { z } from 'zod';
import { BlockSchema } from './blocks.js';
import { EdgeSchema } from './edges.js';
import { PositionSchema, SizeSchema } from './common.js';

/** Bumped whenever the on-disk shape changes; `migrate()` handles older files. */
export const FORMAT_VERSION = 1;

export const GroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  color: z.string().default(''),
  position: PositionSchema.default({ x: 0, y: 0 }),
  size: SizeSchema.default({ width: 600, height: 400 }),
  collapsed: z.boolean().default(false),
});
export type Group = z.infer<typeof GroupSchema>;

export const TechStackSchema = z.object({
  language: z.string().default(''),
  frontend: z.string().default(''),
  backend: z.string().default(''),
  database: z.string().default(''),
  packages: z.array(z.string()).default([]),
  notes: z.string().default(''),
});
export type TechStack = z.infer<typeof TechStackSchema>;

/**
 * `draft` — still being designed; `ready` — the human froze it and it is safe
 * to implement from. The MCP layer warns before generating code from a draft.
 */
export const DiagramStatusSchema = z.enum(['draft', 'ready', 'implemented']);
export type DiagramStatus = z.infer<typeof DiagramStatusSchema>;

export const CanvasSchema = z.object({
  x: z.number().default(0),
  y: z.number().default(0),
  zoom: z.number().positive().default(1),
});

export const DiagramSchema = z.object({
  formatVersion: z.number().int().default(FORMAT_VERSION),
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  /** What the user actually wants to build. Carried into the generated spec. */
  projectGoal: z.string().default(''),
  techStack: TechStackSchema.default({
    language: '',
    frontend: '',
    backend: '',
    database: '',
    packages: [],
    notes: '',
  }),
  status: DiagramStatusSchema.default('draft'),
  /** Increments on every persisted change; used for optimistic concurrency. */
  revision: z.number().int().nonnegative().default(0),
  blocks: z.array(BlockSchema).default([]),
  edges: z.array(EdgeSchema).default([]),
  groups: z.array(GroupSchema).default([]),
  canvas: CanvasSchema.default({ x: 0, y: 0, zoom: 1 }),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
  /** Free-form notes the user or Claude wants to keep with the design. */
  notes: z.string().default(''),
});

export type Diagram = z.infer<typeof DiagramSchema>;
export type DiagramInput = z.input<typeof DiagramSchema>;

/** A trimmed record for list views — avoids shipping every block. */
export interface DiagramSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: DiagramStatus;
  revision: number;
  blockCount: number;
  edgeCount: number;
  createdAt: string;
  updatedAt: string;
}

export function summarize(diagram: Diagram): DiagramSummary {
  return {
    id: diagram.id,
    slug: diagram.slug,
    name: diagram.name,
    description: diagram.description,
    status: diagram.status,
    revision: diagram.revision,
    blockCount: diagram.blocks.length,
    edgeCount: diagram.edges.length,
    createdAt: diagram.createdAt,
    updatedAt: diagram.updatedAt,
  };
}

/**
 * Bring an older on-disk document up to the current format. Kept deliberately
 * boring: read the version, apply each step in order, never throw on unknown
 * extra keys.
 */
export function migrate(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const doc = { ...(raw as Record<string, unknown>) };
  const version = typeof doc['formatVersion'] === 'number' ? (doc['formatVersion'] as number) : 0;

  if (version < 1) {
    // v0 -> v1: the very first files had no formatVersion and used `nodes`.
    if (Array.isArray(doc['nodes']) && !doc['blocks']) {
      doc['blocks'] = doc['nodes'];
      delete doc['nodes'];
    }
    doc['formatVersion'] = 1;
  }

  return doc;
}

export function parseDiagram(raw: unknown): Diagram {
  return DiagramSchema.parse(migrate(raw));
}

export function safeParseDiagram(raw: unknown) {
  return DiagramSchema.safeParse(migrate(raw));
}
