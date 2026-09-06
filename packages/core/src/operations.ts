import { BlockSchema, type Block, type BlockType } from './blocks.js';
import { EdgeSchema, type Edge, type EdgeType } from './edges.js';
import type { Diagram, DiagramStatus, Group } from './diagram.js';
import {
  createBlock,
  createEdge,
  createGroup,
  findBlock,
  requireBlockId,
  type CreateBlockInput,
  type CreateGroupInput,
} from './factory.js';
import { nowIso } from './ids.js';
import { describeSchemaError, type ImplementationStatus } from './common.js';

/**
 * Mutation primitives.
 *
 * Both the REST API and the MCP tools call these, so a block added by Claude
 * and a block added by a drag from the palette go through exactly the same
 * code path — including the same defaults and the same validation.
 */

export interface BlockPatch {
  name?: string;
  summary?: string;
  description?: string;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  groupId?: string | null;
  tags?: string[];
  color?: string;
  /** Merged over the existing payload key by key; arrays are replaced whole. */
  data?: Record<string, unknown>;
  /** Replace the payload outright instead of merging. */
  replaceData?: boolean;
  implementation?: {
    status?: ImplementationStatus;
    files?: string[];
    notes?: string;
  };
}

export function addBlocks(diagram: Diagram, inputs: CreateBlockInput[]): Block[] {
  const created = inputs.map((input, index) => {
    try {
      return createBlock(input);
    } catch (err) {
      // A whole design arrives in one call, so an unattributed schema error
      // leaves the caller re-reading seventeen payloads to find the bad one.
      // Name the block before rethrowing.
      throw new Error(
        `Block ${index + 1} of ${inputs.length} ` +
          `("${input.name ?? 'unnamed'}", type ${input.type}) was rejected — ` +
          describeSchemaError(err),
      );
    }
  });
  diagram.blocks.push(...created);
  return created;
}

export function updateBlock(diagram: Diagram, ref: string, patch: BlockPatch): Block {
  const id = requireBlockId(diagram, ref);
  const index = diagram.blocks.findIndex((b) => b.id === id);
  const current = diagram.blocks[index];
  if (index < 0 || !current) throw new Error(`Block ${ref} vanished mid-update.`);

  const nextData = patch.data
    ? patch.replaceData
      ? patch.data
      : { ...(current.data as Record<string, unknown>), ...patch.data }
    : (current.data as Record<string, unknown>);

  const merged = {
    ...current,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.position !== undefined ? { position: patch.position } : {}),
    ...(patch.size !== undefined ? { size: patch.size } : {}),
    ...(patch.groupId !== undefined ? { groupId: patch.groupId } : {}),
    ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
    ...(patch.color !== undefined ? { color: patch.color } : {}),
    ...(patch.implementation !== undefined
      ? {
          implementation: {
            ...current.implementation,
            ...patch.implementation,
            updatedAt: nowIso(),
          },
        }
      : {}),
    data: nextData,
    updatedAt: nowIso(),
  };

  const parsed = BlockSchema.parse(merged);
  diagram.blocks[index] = parsed;
  return parsed;
}

export interface DeleteBlocksResult {
  deletedBlocks: string[];
  deletedEdges: string[];
  notFound: string[];
}

export function deleteBlocks(diagram: Diagram, refs: string[]): DeleteBlocksResult {
  const ids = new Set<string>();
  const notFound: string[] = [];
  for (const ref of refs) {
    const block = findBlock(diagram, ref);
    if (block) ids.add(block.id);
    else notFound.push(ref);
  }

  const deletedEdges = diagram.edges
    .filter((e) => ids.has(e.source) || ids.has(e.target))
    .map((e) => e.id);

  diagram.blocks = diagram.blocks.filter((b) => !ids.has(b.id));
  diagram.edges = diagram.edges.filter((e) => !ids.has(e.source) && !ids.has(e.target));

  return { deletedBlocks: [...ids], deletedEdges, notFound };
}

export interface AddEdgeInput {
  /** Block id or name. */
  source: string;
  target: string;
  type?: EdgeType;
  label?: string;
  description?: string;
  condition?: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export function addEdges(diagram: Diagram, inputs: AddEdgeInput[]): Edge[] {
  const created: Edge[] = [];
  for (const input of inputs) {
    const source = requireBlockId(diagram, input.source);
    const target = requireBlockId(diagram, input.target);
    const duplicate = diagram.edges.find(
      (e) => e.source === source && e.target === target && e.type === (input.type ?? 'calls'),
    );
    if (duplicate) {
      created.push(duplicate);
      continue;
    }
    const edge = createEdge({ ...input, source, target });
    diagram.edges.push(edge);
    created.push(edge);
  }
  return created;
}

export interface EdgePatch {
  type?: EdgeType;
  label?: string;
  description?: string;
  condition?: string;
  source?: string;
  target?: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export function updateEdge(diagram: Diagram, edgeId: string, patch: EdgePatch): Edge {
  const index = diagram.edges.findIndex((e) => e.id === edgeId);
  const current = diagram.edges[index];
  if (index < 0 || !current) throw new Error(`No connection with id ${edgeId}.`);

  const next = EdgeSchema.parse({
    ...current,
    ...patch,
    ...(patch.source ? { source: requireBlockId(diagram, patch.source) } : {}),
    ...(patch.target ? { target: requireBlockId(diagram, patch.target) } : {}),
    updatedAt: nowIso(),
  });
  diagram.edges[index] = next;
  return next;
}

export function deleteEdges(diagram: Diagram, edgeIds: string[]): string[] {
  const ids = new Set(edgeIds);
  const present = diagram.edges.filter((e) => ids.has(e.id)).map((e) => e.id);
  diagram.edges = diagram.edges.filter((e) => !ids.has(e.id));
  return present;
}

export function moveBlocks(
  diagram: Diagram,
  moves: { block: string; x: number; y: number }[],
): Block[] {
  return moves.map((move) =>
    updateBlock(diagram, move.block, { position: { x: move.x, y: move.y } }),
  );
}

export function addGroup(diagram: Diagram, input: CreateGroupInput): Group {
  const group = createGroup(input);
  diagram.groups.push(group);
  return group;
}

export function deleteGroup(diagram: Diagram, groupId: string): boolean {
  const before = diagram.groups.length;
  diagram.groups = diagram.groups.filter((g) => g.id !== groupId);
  for (const block of diagram.blocks) {
    if (block.groupId === groupId) block.groupId = null;
  }
  return diagram.groups.length < before;
}

export function setStatus(diagram: Diagram, status: DiagramStatus): Diagram {
  diagram.status = status;
  return diagram;
}

export interface MarkImplementedInput {
  block: string;
  status?: ImplementationStatus;
  files?: string[];
  notes?: string;
  /** Add to the existing file list instead of replacing it. */
  appendFiles?: boolean;
}

export function markImplemented(diagram: Diagram, input: MarkImplementedInput): Block {
  const block = diagram.blocks.find((b) => b.id === requireBlockId(diagram, input.block));
  if (!block) throw new Error(`No block matching "${input.block}".`);

  const files = input.files
    ? input.appendFiles
      ? [...new Set([...block.implementation.files, ...input.files])]
      : input.files
    : block.implementation.files;

  return updateBlock(diagram, block.id, {
    implementation: {
      status: input.status ?? 'done',
      files,
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
  });
}

/* ------------------------------------------------------------------ *
 * Batch application
 * ------------------------------------------------------------------ */

export type BatchOperation =
  | { op: 'add_block'; block: CreateBlockInput & { type: BlockType } }
  | { op: 'update_block'; block: string; patch: BlockPatch }
  | { op: 'delete_block'; block: string }
  | { op: 'add_edge'; edge: AddEdgeInput }
  | { op: 'update_edge'; edge: string; patch: EdgePatch }
  | { op: 'delete_edge'; edge: string }
  | { op: 'move_block'; block: string; x: number; y: number }
  | { op: 'add_group'; group: CreateGroupInput }
  | { op: 'delete_group'; group: string }
  | { op: 'set_status'; status: DiagramStatus };

export interface BatchResult {
  applied: number;
  createdBlocks: Block[];
  createdEdges: Edge[];
  errors: { index: number; op: string; message: string }[];
}

/**
 * Apply a list of operations in order. Later operations can refer to blocks
 * created by earlier ones by name, which is what lets Claude build a whole
 * diagram — blocks and wiring — in a single tool call.
 */
export function applyBatch(diagram: Diagram, ops: BatchOperation[]): BatchResult {
  const result: BatchResult = { applied: 0, createdBlocks: [], createdEdges: [], errors: [] };

  ops.forEach((operation, index) => {
    try {
      switch (operation.op) {
        case 'add_block':
          result.createdBlocks.push(...addBlocks(diagram, [operation.block]));
          break;
        case 'update_block':
          updateBlock(diagram, operation.block, operation.patch);
          break;
        case 'delete_block':
          deleteBlocks(diagram, [operation.block]);
          break;
        case 'add_edge':
          result.createdEdges.push(...addEdges(diagram, [operation.edge]));
          break;
        case 'update_edge':
          updateEdge(diagram, operation.edge, operation.patch);
          break;
        case 'delete_edge':
          deleteEdges(diagram, [operation.edge]);
          break;
        case 'move_block':
          moveBlocks(diagram, [{ block: operation.block, x: operation.x, y: operation.y }]);
          break;
        case 'add_group':
          addGroup(diagram, operation.group);
          break;
        case 'delete_group':
          deleteGroup(diagram, operation.group);
          break;
        case 'set_status':
          setStatus(diagram, operation.status);
          break;
      }
      result.applied += 1;
    } catch (err) {
      result.errors.push({
        index,
        op: operation.op,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return result;
}
