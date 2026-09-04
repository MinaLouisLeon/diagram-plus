import { BLOCK_CATALOG } from './catalog.js';
import { BlockSchema, type Block, type BlockType } from './blocks.js';
import { EdgeSchema, type Edge, type EdgeType } from './edges.js';
import {
  DiagramSchema,
  FORMAT_VERSION,
  GroupSchema,
  type Diagram,
  type Group,
} from './diagram.js';
import { newId, nowIso, slugify } from './ids.js';

/**
 * Constructors that fill in every default, so callers — the REST API, the MCP
 * tools, the editor — can pass just the interesting bits.
 */

export interface CreateBlockInput {
  type: BlockType;
  name?: string;
  summary?: string;
  description?: string;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  groupId?: string | null;
  tags?: string[];
  color?: string;
  data?: Record<string, unknown>;
  id?: string;
}

export function createBlock(input: CreateBlockInput): Block {
  const info = BLOCK_CATALOG[input.type];
  const ts = nowIso();
  return BlockSchema.parse({
    id: input.id ?? newId('blk'),
    type: input.type,
    name: input.name?.trim() || info.defaultName,
    summary: input.summary ?? '',
    description: input.description ?? '',
    position: input.position ?? { x: 0, y: 0 },
    size: input.size ?? defaultSizeFor(input.type),
    groupId: input.groupId ?? null,
    tags: input.tags ?? [],
    color: input.color ?? '',
    data: input.data ?? {},
    createdAt: ts,
    updatedAt: ts,
  });
}

export function defaultSizeFor(type: BlockType): { width: number; height: number } {
  switch (type) {
    case 'note':
      return { width: 240, height: 160 };
    case 'decision':
      return { width: 220, height: 130 };
    case 'data_model':
    case 'api_endpoint':
    case 'service':
      return { width: 300, height: 170 };
    default:
      return { width: 280, height: 150 };
  }
}

export interface CreateEdgeInput {
  source: string;
  target: string;
  type?: EdgeType;
  label?: string;
  description?: string;
  condition?: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  payload?: unknown[];
  id?: string;
}

export function createEdge(input: CreateEdgeInput): Edge {
  const ts = nowIso();
  return EdgeSchema.parse({
    id: input.id ?? newId('edg'),
    type: input.type ?? 'calls',
    source: input.source,
    target: input.target,
    sourceHandle: input.sourceHandle ?? null,
    targetHandle: input.targetHandle ?? null,
    label: input.label ?? '',
    description: input.description ?? '',
    condition: input.condition ?? '',
    payload: input.payload ?? [],
    createdAt: ts,
    updatedAt: ts,
  });
}

export interface CreateGroupInput {
  name: string;
  description?: string;
  color?: string;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  id?: string;
}

export function createGroup(input: CreateGroupInput): Group {
  return GroupSchema.parse({
    id: input.id ?? newId('grp'),
    name: input.name,
    description: input.description ?? '',
    color: input.color ?? '',
    position: input.position ?? { x: 0, y: 0 },
    size: input.size ?? { width: 600, height: 400 },
  });
}

export interface CreateDiagramInput {
  name: string;
  slug?: string;
  description?: string;
  projectGoal?: string;
  techStack?: Record<string, unknown>;
  notes?: string;
  id?: string;
}

export function createDiagram(input: CreateDiagramInput): Diagram {
  const ts = nowIso();
  return DiagramSchema.parse({
    formatVersion: FORMAT_VERSION,
    id: input.id ?? newId('dgm'),
    slug: input.slug ?? slugify(input.name),
    name: input.name,
    description: input.description ?? '',
    projectGoal: input.projectGoal ?? '',
    techStack: input.techStack ?? {},
    status: 'draft',
    revision: 1,
    blocks: [],
    edges: [],
    groups: [],
    notes: input.notes ?? '',
    createdAt: ts,
    updatedAt: ts,
  });
}

/** Find a block by id, or by exact/case-insensitive name. */
export function findBlock(diagram: Diagram, ref: string): Block | undefined {
  const byId = diagram.blocks.find((b) => b.id === ref);
  if (byId) return byId;
  const exact = diagram.blocks.find((b) => b.name === ref);
  if (exact) return exact;
  const lower = ref.toLowerCase();
  return diagram.blocks.find((b) => b.name.toLowerCase() === lower);
}

/**
 * Resolve a block reference to an id, throwing a message that names the block
 * the caller asked for — much easier for Claude to recover from than a null.
 */
export function requireBlockId(diagram: Diagram, ref: string): string {
  const block = findBlock(diagram, ref);
  if (!block) {
    throw new Error(
      `No block matching "${ref}" in diagram "${diagram.name}". ` +
        `Known blocks: ${diagram.blocks.map((b) => `${b.name} (${b.id})`).join(', ') || 'none'}`,
    );
  }
  return block.id;
}
