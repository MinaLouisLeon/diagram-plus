import { z } from 'zod';
import { BlockTypeSchema, type BlockType } from './blocks.js';
import { EdgeTypeSchema } from './edges.js';
import { PositionSchema, SizeSchema } from './common.js';
import { TreeOptionsSchema } from './fold.js';
import { kindOfType, type TreeNodeKind } from './tree.js';

/**
 * The client view.
 *
 * The technical diagram is the truth, and it is unreadable to the person
 * paying for the work. This is the other document: the same project drawn as
 * plain boxes and arrows, small enough to walk through on a call, and — the
 * point of it — editable while that call is happening.
 *
 * It is a document of its own rather than a live rendering, because a review
 * with a client produces things the technical diagram cannot hold yet: a box
 * called "text the customer when it ships" that nobody has decided is a job or
 * an integration. Those live here until somebody — usually Claude, through the
 * MCP tools — works out what they really are.
 *
 * Every node keeps a `blockId` when it stands for a real block, so the two
 * documents can be compared rather than guessed at:
 *
 * - `deriveClientView`   builds a fresh view from the diagram;
 * - `reconcileClientView` re-derives without throwing away the client's work;
 * - `diffClientView`     says what the client changed that the diagram lacks;
 * - `applyClientView`    carries those changes into the diagram.
 *
 * Nothing here deletes anything silently. A box the client removed becomes a
 * tombstone, so the next reconcile does not quietly put it back and so the
 * removal is still there to be applied — or reversed — later.
 */

/** What a box is: derived from the diagram, or added in front of the client. */
export const CLIENT_ORIGINS = ['diagram', 'client'] as const;
export type ClientOrigin = (typeof CLIENT_ORIGINS)[number];

export const ClientBranchSchema = z.object({
  label: z.string().default(''),
  when: z.string().default(''),
});

export const ClientNodeSchema = z.object({
  id: z.string().min(1),
  /** The technical block this stands for, or null when it is new. */
  blockId: z.string().nullable().default(null),
  type: BlockTypeSchema.default('ui_screen'),
  name: z.string().default(''),
  /** One plain line under the name. */
  description: z.string().default(''),
  /** For a decision: the question being asked. */
  condition: z.string().default(''),
  branches: z.array(ClientBranchSchema).default([]),
  position: PositionSchema.default({ x: 0, y: 0 }),
  size: SizeSchema.default({ width: 260, height: 96 }),
  /** True once someone dragged it, which stops the auto-layout moving it. */
  pinned: z.boolean().default(false),
  /** Reading order — what the walkthrough covers first. */
  order: z.number().int().default(0),
  origin: z.enum(CLIENT_ORIGINS).default('diagram'),
  /** The wording was changed here, so a re-derive must not overwrite it. */
  edited: z.boolean().default(false),
  /** Its block has gone from the diagram. Kept so the loss is visible. */
  orphaned: z.boolean().default(false),
  /** Technical blocks folded into this box. */
  via: z.array(z.string()).default([]),
  /** What the client actually said, kept verbatim. */
  note: z.string().default(''),
});
export type ClientNode = z.infer<typeof ClientNodeSchema>;

export const ClientEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  type: EdgeTypeSchema.default('navigation'),
  label: z.string().default(''),
  /** "the card was declined" — rendered as "If the card was declined". */
  condition: z.string().default(''),
  /** The technical edge this stands for, when it is a single hop. */
  edgeId: z.string().nullable().default(null),
  origin: z.enum(CLIENT_ORIGINS).default('diagram'),
  /** Technical blocks this arrow passes through. */
  via: z.array(z.string()).default([]),
});
export type ClientEdge = z.infer<typeof ClientEdgeSchema>;

/** A box the client removed. Kept so the removal survives the next sync. */
export const ClientRemovalSchema = z.object({
  blockId: z.string().default(''),
  edgeId: z.string().default(''),
  name: z.string().default(''),
  at: z.string().default(''),
});
export type ClientRemoval = z.infer<typeof ClientRemovalSchema>;

export const ClientViewSchema = z.object({
  /** How it was derived, so a re-derive asks the same question. */
  options: TreeOptionsSchema.default({}),
  nodes: z.array(ClientNodeSchema).default([]),
  edges: z.array(ClientEdgeSchema).default([]),
  /** Boxes and arrows the client deleted, waiting to be applied. */
  removed: z.array(ClientRemovalSchema).default([]),
  /** Free text — what came out of the meeting. */
  notes: z.string().default(''),
  /** When the two documents were last brought into line. */
  syncedAt: z.string().default(''),
  updatedAt: z.string().default(''),
});
export type ClientView = z.infer<typeof ClientViewSchema>;

export const CLIENT_NODE_SIZE = { width: 260, height: 96 };

/* ------------------------------------------------------------------ *
 * Plain words
 * ------------------------------------------------------------------ */

const KIND_WORD: Record<TreeNodeKind, string> = {
  section: 'part',
  screen: 'screen',
  shows: 'shows',
  action: 'step',
  question: 'decision',
  branch: 'outcome',
  automation: 'automatic',
  integration: 'outside service',
  data: 'information',
  note: 'note',
  repeat: 'seen above',
};

/** What to call a block type in front of someone who does not build software. */
export function clientWordFor(type: BlockType): string {
  return KIND_WORD[kindOfType(type)];
}

/* ------------------------------------------------------------------ *
 * Layout
 * ------------------------------------------------------------------ */

export interface ClientLayoutOptions {
  direction?: 'TB' | 'LR';
  /** Move even the boxes somebody dragged. */
  includePinned?: boolean;
}

/**
 * Arrange the boxes as a flow: one layer per step away from the start, in
 * reading order across each layer.
 *
 * A box that has been dragged is left where it was put — the client view is
 * something people arrange while talking over it, and having that undone by
 * the next edit would be worse than an imperfect layout.
 */
export function layoutClientView(view: ClientView, options: ClientLayoutOptions = {}): ClientView {
  const { direction = 'TB', includePinned = false } = options;
  const nodes = view.nodes;
  if (!nodes.length) return view;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of view.edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target) || edge.source === edge.target) continue;
    if (edge.type !== 'error_flow') {
      incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    }
    const list = outgoing.get(edge.source);
    if (list) list.push(edge.target);
    else outgoing.set(edge.source, [edge.target]);
  }

  const byOrder = [...nodes].sort((a, b) => a.order - b.order);
  const layer = new Map<string, number>();
  const queue: string[] = byOrder.filter((n) => (incoming.get(n.id) ?? 0) === 0).map((n) => n.id);
  for (const id of queue) layer.set(id, 0);
  // Anything only reachable through a cycle still needs a layer.
  if (!queue.length && byOrder[0]) {
    queue.push(byOrder[0].id);
    layer.set(byOrder[0].id, 0);
  }
  while (queue.length) {
    const id = queue.shift()!;
    const depth = layer.get(id) ?? 0;
    for (const next of outgoing.get(id) ?? []) {
      if (layer.has(next)) continue;
      layer.set(next, depth + 1);
      queue.push(next);
    }
  }
  let orphanLayer = Math.max(0, ...layer.values()) + 1;
  for (const node of byOrder) {
    if (!layer.has(node.id)) layer.set(node.id, orphanLayer);
  }

  const lanes = new Map<number, ClientNode[]>();
  for (const node of byOrder) {
    const depth = layer.get(node.id) ?? 0;
    const lane = lanes.get(depth);
    if (lane) lane.push(node);
    else lanes.set(depth, [node]);
  }

  const gapX = CLIENT_NODE_SIZE.width + 60;
  const gapY = CLIENT_NODE_SIZE.height + 80;

  const moved = nodes.map((node) => {
    if (node.pinned && !includePinned) return node;
    const depth = layer.get(node.id) ?? 0;
    const lane = lanes.get(depth)!;
    const index = lane.indexOf(node);
    const spread = (index - (lane.length - 1) / 2) * gapX;
    const position =
      direction === 'TB'
        ? { x: Math.round(spread), y: depth * gapY }
        : { x: depth * gapX, y: Math.round(spread) };
    return { ...node, position, pinned: includePinned ? false : node.pinned };
  });

  return { ...view, nodes: moved };
}
