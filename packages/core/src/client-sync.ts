import type { Block, BlockType } from './blocks.js';
import type { EdgeType } from './edges.js';
import type { Diagram } from './diagram.js';
import { newId, nowIso } from './ids.js';
import { applyBatch, type BatchOperation, type BatchResult } from './operations.js';
import {
  conditionOf,
  foldDiagram,
  plainDetail,
  resolveTreeOptions,
  stepLabel,
  type TreeOptions,
} from './fold.js';
import { entryBlocks, readingOrder } from './tree.js';
import {
  CLIENT_NODE_SIZE,
  ClientEdgeSchema,
  ClientNodeSchema,
  ClientViewSchema,
  clientWordFor,
  layoutClientView,
  type ClientEdge,
  type ClientNode,
  type ClientOrigin,
  type ClientRemoval,
  type ClientView,
} from './client-view.js';

/**
 * Keeping the two documents in step.
 *
 * `client-view.ts` says what a client view *is*; this says how it is built
 * from the technical diagram, what the client changed while looking at it, and
 * how those changes get carried back. The split is not cosmetic — the diagram
 * schema has to be able to hold a client view, so the schema cannot be allowed
 * to depend on the diagram.
 */

/* ------------------------------------------------------------------ *
 * Deriving
 * ------------------------------------------------------------------ */

function branchesOf(block: Block): { label: string; when: string }[] {
  return block.type === 'decision'
    ? block.data.branches.map((b) => ({ label: b.label, when: b.when }))
    : [];
}

function conditionTextOf(block: Block): string {
  return block.type === 'decision' ? block.data.condition : '';
}

/**
 * Build a client view from the diagram, from scratch.
 *
 * One box per block the audience is allowed to see, one arrow per path between
 * two of them — including paths that run through folded plumbing, which is why
 * a screen that calls an endpoint that calls a service shows an arrow straight
 * to whatever the service reaches.
 */
export function deriveClientView(diagram: Diagram, options: TreeOptions = {}): ClientView {
  const fold = foldDiagram(diagram, options);
  const { opts, visible, slotsFor } = fold;

  // Reading order: breadth-first from the entry points, so the walkthrough
  // starts where a user would and the auto-layout has an order to lay out in.
  const ordered: Block[] = [];
  const placed = new Set<string>();
  const queue = [...entryBlocks(fold)];
  while (queue.length) {
    const block = queue.shift()!;
    if (placed.has(block.id)) continue;
    placed.add(block.id);
    ordered.push(block);
    const next = slotsFor(block)
      .flatMap((slot) => slot.targets)
      .filter((target) => !placed.has(target.id));
    queue.push(...next);
  }
  for (const block of [...visible].sort(readingOrder)) {
    if (!placed.has(block.id)) {
      placed.add(block.id);
      ordered.push(block);
    }
  }

  const nodes: ClientNode[] = ordered.map((block, index) => {
    // A decision's question is its own field, so the supporting line must not
    // repeat it back.
    const condition = conditionTextOf(block);
    const detail = plainDetail(block, opts);
    return ClientNodeSchema.parse({
      id: newId('cvn'),
      blockId: block.id,
      type: block.type,
      name: block.name,
      description: detail === condition ? '' : detail,
      condition,
      branches: branchesOf(block),
      position: block.position,
      size: CLIENT_NODE_SIZE,
      order: index,
      origin: 'diagram',
    });
  });

  const nodeByBlock = new Map(nodes.map((node) => [node.blockId!, node]));
  const edges: ClientEdge[] = [];
  const seen = new Set<string>();

  for (const block of ordered) {
    const source = nodeByBlock.get(block.id)!;
    for (const slot of slotsFor(block)) {
      // A hop the filter removed does not get to name the step; the arrow
      // still has to arrive, so it carries on unnamed.
      const named = slot.hop && fold.roleOf(slot.hop) !== 'conduct' ? slot.hop : null;
      for (const target of slot.targets) {
        const to = nodeByBlock.get(target.id);
        if (!to || to.id === source.id) continue;
        const key = `${source.id}>${to.id}>${slot.edge.type}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push(
          ClientEdgeSchema.parse({
            id: newId('cve'),
            source: source.id,
            target: to.id,
            type: slot.edge.type,
            label: named ? stepLabel(block, slot.edge, named) : slot.edge.label,
            condition: conditionOf(slot.edge, opts),
            edgeId: slot.hop ? null : slot.edge.id,
            origin: 'diagram',
            // Everything this one arrow stands for, hop included — a technical
            // reader wants the whole folded run, not the tail of it.
            via: slot.hop ? [slot.hop.name, ...slot.via.map((b) => b.name)] : [],
          }),
        );
      }
    }
  }

  const view = ClientViewSchema.parse({
    options,
    nodes,
    edges,
    syncedAt: nowIso(),
    updatedAt: nowIso(),
  });
  return layoutClientView(view);
}

/* ------------------------------------------------------------------ *
 * Reconciling
 * ------------------------------------------------------------------ */

export interface ReconcileResult {
  view: ClientView;
  /** Boxes that appeared because the diagram gained blocks. */
  added: string[];
  /** Boxes whose wording was refreshed from the diagram. */
  updated: string[];
  /** Boxes whose block has gone. */
  orphaned: string[];
}

/**
 * Re-derive the view from the diagram without losing what happened in the
 * meeting.
 *
 * Anything the client added stays. Anything they reworded keeps their wording.
 * Anything they deleted stays deleted. Everything else is brought up to date,
 * which is the "other way around" half of the sync: a change Claude made to
 * the technical diagram shows up here.
 */
export function reconcileClientView(
  diagram: Diagram,
  existing: ClientView,
  options?: TreeOptions,
): ReconcileResult {
  const opts = options ?? existing.options ?? {};
  const derived = deriveClientView(diagram, opts);
  const blockIds = new Set(diagram.blocks.map((b) => b.id));
  const tombstoned = new Set(existing.removed.map((r) => r.blockId).filter(Boolean));

  const existingByBlock = new Map<string, ClientNode>();
  for (const node of existing.nodes) {
    if (node.blockId) existingByBlock.set(node.blockId, node);
  }

  const added: string[] = [];
  const updated: string[] = [];
  const orphaned: string[] = [];

  const nodes: ClientNode[] = [];
  const usedBlocks = new Set<string>();

  for (const fresh of derived.nodes) {
    const blockId = fresh.blockId!;
    if (tombstoned.has(blockId)) continue;
    usedBlocks.add(blockId);
    const previous = existingByBlock.get(blockId);
    if (!previous) {
      added.push(fresh.name);
      nodes.push(fresh);
      continue;
    }
    // The client's wording wins; everything else is refreshed.
    const keptText = previous.edited;
    if (!keptText && (previous.name !== fresh.name || previous.description !== fresh.description)) {
      updated.push(fresh.name);
    }
    nodes.push({
      ...previous,
      type: fresh.type,
      name: keptText ? previous.name : fresh.name,
      description: keptText ? previous.description : fresh.description,
      condition: keptText ? previous.condition : fresh.condition,
      branches: keptText ? previous.branches : fresh.branches,
      via: fresh.via,
      orphaned: false,
    });
  }

  // Everything the client put here, plus anything whose block has gone.
  for (const previous of existing.nodes) {
    if (previous.blockId && usedBlocks.has(previous.blockId)) continue;
    if (previous.blockId && tombstoned.has(previous.blockId)) continue;
    if (previous.blockId && !blockIds.has(previous.blockId)) {
      orphaned.push(previous.name);
      nodes.push({ ...previous, orphaned: true });
      continue;
    }
    // Either client-added, or a block the current filter hides. Both stay.
    nodes.push(previous);
  }

  nodes.sort((a, b) => a.order - b.order);
  nodes.forEach((node, index) => {
    node.order = index;
  });

  /* ---- edges ------------------------------------------------------ */

  const nodeIdByBlock = new Map<string, string>();
  for (const node of nodes) {
    if (node.blockId) nodeIdByBlock.set(node.blockId, node.id);
  }
  const derivedNodeBlock = new Map(derived.nodes.map((n) => [n.id, n.blockId!]));
  const live = new Set(nodes.map((n) => n.id));
  const removedEdgeIds = new Set(existing.removed.map((r) => r.edgeId).filter(Boolean));

  const edges: ClientEdge[] = [];
  const edgeKeys = new Set<string>();
  const keyOf = (edge: { source: string; target: string; type: EdgeType }): string =>
    `${edge.source}>${edge.target}>${edge.type}`;

  const existingByKey = new Map(existing.edges.map((edge) => [keyOf(edge), edge]));

  for (const fresh of derived.edges) {
    const source = nodeIdByBlock.get(derivedNodeBlock.get(fresh.source) ?? '');
    const target = nodeIdByBlock.get(derivedNodeBlock.get(fresh.target) ?? '');
    if (!source || !target) continue;
    const rebased = { ...fresh, source, target };
    if (rebased.edgeId && removedEdgeIds.has(rebased.edgeId)) continue;
    const key = keyOf(rebased);
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    const previous = existingByKey.get(key);
    edges.push(previous ? { ...rebased, id: previous.id } : rebased);
  }

  for (const previous of existing.edges) {
    const key = keyOf(previous);
    if (edgeKeys.has(key)) continue;
    if (!live.has(previous.source) || !live.has(previous.target)) continue;
    // Only what the client drew survives a re-derive; a derived arrow that is
    // no longer derived is an arrow the diagram no longer has.
    if (previous.origin !== 'client') continue;
    edgeKeys.add(key);
    edges.push(previous);
  }

  const view: ClientView = {
    ...existing,
    options: opts,
    nodes,
    edges,
    syncedAt: nowIso(),
    updatedAt: nowIso(),
  };

  return { view: layoutClientView(view), added, updated, orphaned };
}

/** Get the stored view, deriving one the first time it is asked for. */
export function ensureClientView(diagram: Diagram, options?: TreeOptions): ClientView {
  if (diagram.clientView) {
    return options ? reconcileClientView(diagram, diagram.clientView, options).view : diagram.clientView;
  }
  return deriveClientView(diagram, options ?? {});
}

/* ------------------------------------------------------------------ *
 * What changed
 * ------------------------------------------------------------------ */

export interface ClientViewDiff {
  /** Boxes the client added that have no block behind them. */
  addedNodes: ClientNode[];
  /** Boxes whose wording the client changed. */
  reworded: { node: ClientNode; blockId: string; from: string; to: string }[];
  /** Arrows the client drew that the diagram does not have. */
  addedEdges: ClientEdge[];
  /** Boxes and arrows the client removed. */
  removed: ClientRemoval[];
  /** Boxes whose block has gone from the diagram since. */
  orphaned: ClientNode[];
  /** Blocks that are in the diagram but not yet in this view. */
  missing: { blockId: string; name: string }[];
  /**
   * The order the client wants to walk through it in, when it is no longer
   * the order the diagram implies. Not applied automatically: what "before"
   * means in a graph is a judgement, and it belongs to whoever reads this.
   */
  reordered: string[];
  hasChanges: boolean;
}

function blockText(block: Block, view: ClientView): { name: string; description: string } {
  const opts = resolveTreeOptions(view.options ?? {});
  return { name: block.name, description: plainDetail(block, opts) };
}

/** What the client changed that the technical diagram does not know about. */
export function diffClientView(diagram: Diagram, view: ClientView): ClientViewDiff {
  const byId = new Map(diagram.blocks.map((b) => [b.id, b]));

  const addedNodes = view.nodes.filter((node) => !node.blockId && !node.orphaned);
  const orphaned = view.nodes.filter((node) => node.orphaned);

  const reworded: ClientViewDiff['reworded'] = [];
  for (const node of view.nodes) {
    if (!node.blockId || !node.edited) continue;
    const block = byId.get(node.blockId);
    if (!block) continue;
    const text = blockText(block, view);
    if (text.name !== node.name || text.description !== node.description) {
      reworded.push({ node, blockId: node.blockId, from: text.name, to: node.name });
    }
  }

  const addedEdges = view.edges.filter((edge) => edge.origin === 'client' && !edge.edgeId);

  // Blocks the view has never seen. Filtered-out blocks are not "missing" —
  // they were deliberately left out of this view.
  const known = new Set(view.nodes.map((n) => n.blockId).filter(Boolean) as string[]);
  const tombstoned = new Set(view.removed.map((r) => r.blockId).filter(Boolean));
  const fold = foldDiagram(diagram, view.options ?? {});
  const missing = fold.visible
    .filter((block) => !known.has(block.id) && !tombstoned.has(block.id))
    .map((block) => ({ blockId: block.id, name: block.name }));

  const derivedOrder = deriveClientView(diagram, view.options ?? {}).nodes
    .map((n) => n.blockId!)
    .filter((id) => known.has(id));
  const viewOrder = [...view.nodes]
    .sort((a, b) => a.order - b.order)
    .map((n) => n.blockId)
    .filter((id): id is string => Boolean(id) && derivedOrder.includes(id!));
  const reordered =
    derivedOrder.join('|') === viewOrder.join('|')
      ? []
      : viewOrder.map((id) => byId.get(id)?.name ?? id);

  return {
    addedNodes,
    reworded,
    addedEdges,
    removed: view.removed,
    orphaned,
    missing,
    reordered,
    hasChanges:
      addedNodes.length > 0 ||
      reworded.length > 0 ||
      addedEdges.length > 0 ||
      view.removed.length > 0,
  };
}

/* ------------------------------------------------------------------ *
 * Carrying it back
 * ------------------------------------------------------------------ */

export interface ApplyClientViewOptions {
  /** Carry deletions across too. Off by default: losing work is the one
   *  mistake that cannot be undone from the other document. */
  includeRemovals?: boolean;
  /** Work out the operations without running them. */
  dryRun?: boolean;
}

/**
 * Turn the client's edits into operations on the technical diagram.
 *
 * A box the client added becomes a real block of whatever type it was given,
 * tagged `from-client` and left thin — the name and one line — because filling
 * in the endpoint, the fields and the wiring is the job of whoever reads the
 * tag next.
 */
export function clientViewOperations(
  diagram: Diagram,
  view: ClientView,
  options: ApplyClientViewOptions = {},
): BatchOperation[] {
  const diff = diffClientView(diagram, view);
  const ops: BatchOperation[] = [];
  const nodeById = new Map(view.nodes.map((n) => [n.id, n]));

  for (const node of diff.addedNodes) {
    const data: Record<string, unknown> = {};
    if (node.type === 'decision') {
      data['condition'] = node.condition || node.description;
      if (node.branches.length) data['branches'] = node.branches;
    } else if (node.type === 'ui_screen') {
      data['purpose'] = node.description;
    } else if (node.type === 'note') {
      data['text'] = node.description || node.note;
    }
    ops.push({
      op: 'add_block',
      block: {
        type: node.type,
        name: node.name,
        summary: node.description,
        description: node.note,
        position: node.position,
        tags: ['from-client'],
        ...(Object.keys(data).length ? { data } : {}),
      },
    });
  }

  for (const change of diff.reworded) {
    const patch: Record<string, unknown> = { name: change.node.name };
    if (change.node.description) patch['summary'] = change.node.description;
    ops.push({ op: 'update_block', block: change.blockId, patch });
    if (change.node.type === 'decision' && change.node.condition) {
      ops.push({
        op: 'update_block',
        block: change.blockId,
        patch: {
          data: {
            condition: change.node.condition,
            ...(change.node.branches.length ? { branches: change.node.branches } : {}),
          },
        },
      });
    }
  }

  // Operations refer to blocks created earlier in the same batch by name,
  // which is what lets a new box and the arrow to it arrive together.
  const refFor = (nodeId: string): string | null => {
    const node = nodeById.get(nodeId);
    if (!node) return null;
    return node.blockId ?? (node.orphaned ? null : node.name);
  };

  for (const edge of diff.addedEdges) {
    const source = refFor(edge.source);
    const target = refFor(edge.target);
    if (!source || !target) continue;
    ops.push({
      op: 'add_edge',
      edge: {
        source,
        target,
        type: edge.type,
        label: edge.label,
        condition: edge.condition,
      },
    });
  }

  if (options.includeRemovals) {
    for (const removal of diff.removed) {
      if (removal.blockId) ops.push({ op: 'delete_block', block: removal.blockId });
      else if (removal.edgeId) ops.push({ op: 'delete_edge', edge: removal.edgeId });
    }
  }

  return ops;
}

export interface ApplyClientViewResult {
  operations: BatchOperation[];
  batch: BatchResult | null;
  /** The view with its new boxes now pointing at real blocks. */
  view: ClientView;
  summary: string;
}

/**
 * Apply the client's edits to the diagram, then relink the view so the boxes
 * that were new point at the blocks they created.
 *
 * The diagram is mutated in place, the way every other operation in this
 * package works; the caller decides whether to write it.
 */
export function applyClientView(
  diagram: Diagram,
  options: ApplyClientViewOptions = {},
): ApplyClientViewResult {
  const view = ensureClientView(diagram);
  const operations = clientViewOperations(diagram, view, options);

  if (options.dryRun || !operations.length) {
    return {
      operations,
      batch: null,
      view,
      summary: operations.length
        ? `${operations.length} change${operations.length === 1 ? '' : 's'} ready to apply.`
        : 'The client view has nothing the diagram is missing.',
    };
  }

  const batch = applyBatch(diagram, operations);

  // Relink: a box that was new now stands for the block it just created.
  const createdByName = new Map(batch.createdBlocks.map((block) => [block.name, block]));
  const nodes = view.nodes.map((node) => {
    if (node.blockId) return { ...node, edited: false };
    const created = createdByName.get(node.name);
    if (!created) return node;
    return { ...node, blockId: created.id, edited: false };
  });

  const linked = new Set(batch.createdEdges.map((edge) => `${edge.source}>${edge.target}`));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edges = view.edges.map((edge) => {
    if (edge.edgeId) return edge;
    const source = nodeById.get(edge.source)?.blockId;
    const target = nodeById.get(edge.target)?.blockId;
    if (!source || !target || !linked.has(`${source}>${target}`)) return edge;
    const created = batch.createdEdges.find((e) => e.source === source && e.target === target);
    return created ? { ...edge, edgeId: created.id, origin: 'diagram' as ClientOrigin } : edge;
  });

  const next: ClientView = {
    ...view,
    nodes,
    edges,
    removed: options.includeRemovals ? [] : view.removed,
    syncedAt: nowIso(),
    updatedAt: nowIso(),
  };
  diagram.clientView = next;

  const parts: string[] = [];
  if (batch.createdBlocks.length) parts.push(`${batch.createdBlocks.length} new block(s)`);
  if (batch.createdEdges.length) parts.push(`${batch.createdEdges.length} new connection(s)`);
  const updates = operations.filter((op) => op.op === 'update_block').length;
  if (updates) parts.push(`${updates} reworded`);
  const deletes = operations.filter(
    (op) => op.op === 'delete_block' || op.op === 'delete_edge',
  ).length;
  if (deletes) parts.push(`${deletes} removed`);

  return {
    operations,
    batch,
    view: next,
    summary: parts.length ? `Applied: ${parts.join(', ')}.` : 'Nothing to apply.',
    };
}

/* ------------------------------------------------------------------ *
 * Reading it out
 * ------------------------------------------------------------------ */

/** The client view as text, for a tool response or a terminal. */
export function renderClientView(diagram: Diagram, view: ClientView): string {
  const lines: string[] = [];
  const nodes = [...view.nodes].sort((a, b) => a.order - b.order);
  lines.push(`${diagram.name} — client view`);
  if (diagram.description || diagram.projectGoal) {
    lines.push(diagram.description || diagram.projectGoal);
  }
  lines.push('');
  lines.push(`Boxes (${nodes.length})`);
  if (!nodes.length) lines.push('  (none)');

  const label = new Map(nodes.map((node, index) => [node.id, `${index + 1}`]));
  for (const [index, node] of nodes.entries()) {
    const marks: string[] = [];
    if (!node.blockId) marks.push('added here');
    if (node.edited) marks.push('reworded here');
    if (node.orphaned) marks.push('its block is gone');
    const suffix = marks.length ? `  [${marks.join('; ')}]` : '';
    lines.push(`  ${index + 1}. ${node.name} (${clientWordFor(node.type)})${suffix}`);
    if (node.description) lines.push(`     ${node.description}`);
    if (node.condition) lines.push(`     asks: ${node.condition}`);
    for (const branch of node.branches) {
      lines.push(`     - ${branch.label}${branch.when ? `: ${branch.when}` : ''}`);
    }
    if (node.note) lines.push(`     note: ${node.note}`);
  }

  lines.push('');
  lines.push(`Arrows (${view.edges.length})`);
  if (!view.edges.length) lines.push('  (none)');
  const nameOf = (id: string): string => view.nodes.find((n) => n.id === id)?.name ?? '?';
  for (const edge of view.edges) {
    const from = `${label.get(edge.source) ?? '?'}. ${nameOf(edge.source)}`;
    const to = `${label.get(edge.target) ?? '?'}. ${nameOf(edge.target)}`;
    const bits: string[] = [];
    if (edge.condition) bits.push(`if ${edge.condition}`);
    if (edge.label && edge.label !== edge.condition) bits.push(edge.label);
    if (edge.origin === 'client') bits.push('drawn here');
    lines.push(`  ${from} → ${to}${bits.length ? `  (${bits.join('; ')})` : ''}`);
  }

  if (view.notes) {
    lines.push('', 'Notes from the review', view.notes);
  }

  const diff = diffClientView(diagram, view);
  lines.push('', describeClientViewDiff(diff));
  return lines.join('\n');
}

/** The reconciliation report: what one document has that the other does not. */
export function describeClientViewDiff(diff: ClientViewDiff): string {
  const lines: string[] = [];
  if (!diff.hasChanges && !diff.missing.length && !diff.orphaned.length && !diff.reordered.length) {
    return 'The client view and the technical diagram agree.';
  }

  lines.push('Not in the technical diagram yet');
  const empty = lines.length;
  for (const node of diff.addedNodes) {
    lines.push(`  + new ${clientWordFor(node.type)} "${node.name}"${node.description ? ` — ${node.description}` : ''}`);
  }
  for (const change of diff.reworded) {
    lines.push(`  ~ reworded "${change.from}" → "${change.to}"`);
  }
  for (const edge of diff.addedEdges) {
    lines.push(`  + new connection${edge.condition ? ` (if ${edge.condition})` : ''}`);
  }
  for (const removal of diff.removed) {
    lines.push(`  - removed "${removal.name}"`);
  }
  if (lines.length === empty) lines.pop();

  if (diff.missing.length) {
    lines.push('In the diagram but not in the client view');
    for (const item of diff.missing) lines.push(`  · ${item.name}`);
  }
  if (diff.orphaned.length) {
    lines.push('Boxes whose block has been deleted');
    for (const node of diff.orphaned) lines.push(`  · ${node.name}`);
  }
  if (diff.reordered.length) {
    lines.push(`Walkthrough order the client wants: ${diff.reordered.join(' → ')}`);
  }

  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * Editing
 * ------------------------------------------------------------------ */

export type ClientViewOperation =
  | {
      op: 'add_node';
      name: string;
      type?: BlockType;
      description?: string;
      condition?: string;
      branches?: { label: string; when?: string }[];
      note?: string;
      /** Put it after this box in the walkthrough, by id or name. */
      after?: string;
      position?: { x: number; y: number };
    }
  | {
      op: 'update_node';
      node: string;
      name?: string;
      type?: BlockType;
      description?: string;
      condition?: string;
      branches?: { label: string; when?: string }[];
      note?: string;
    }
  | { op: 'remove_node'; node: string }
  | { op: 'move_node'; node: string; x: number; y: number }
  | {
      op: 'add_edge';
      source: string;
      target: string;
      type?: EdgeType;
      label?: string;
      condition?: string;
    }
  | { op: 'remove_edge'; source: string; target: string }
  /** The whole walkthrough order, by id or name; anything left out keeps its place at the end. */
  | { op: 'reorder'; order: string[] }
  | { op: 'set_notes'; notes: string };

export interface EditClientViewResult {
  view: ClientView;
  applied: number;
  errors: { index: number; op: string; message: string }[];
}

/**
 * Apply edits to a client view.
 *
 * The same vocabulary serves the editor and the MCP tools, so a box added in
 * front of a client and a box added by Claude are the same kind of change by
 * the time they are stored. Boxes are addressed by id or by name, because the
 * person asking for the edit is usually reading the names.
 */
export function editClientView(
  view: ClientView,
  operations: ClientViewOperation[],
): EditClientViewResult {
  let nodes = [...view.nodes];
  let edges = [...view.edges];
  const removed = [...view.removed];
  let notes = view.notes;
  const errors: EditClientViewResult['errors'] = [];
  let applied = 0;

  const resolve = (ref: string): ClientNode | undefined => {
    const needle = ref.trim().toLowerCase();
    return nodes.find((n) => n.id === ref) ?? nodes.find((n) => n.name.toLowerCase() === needle);
  };

  const renumber = (): void => {
    nodes = nodes.map((node, index) => ({ ...node, order: index }));
  };

  operations.forEach((operation, index) => {
    try {
      switch (operation.op) {
        case 'add_node': {
          const name = operation.name.trim();
          if (!name) throw new Error('A box needs a name.');
          const node = ClientNodeSchema.parse({
            id: newId('cvn'),
            blockId: null,
            type: operation.type ?? 'ui_screen',
            name,
            description: operation.description ?? '',
            condition: operation.condition ?? '',
            branches: (operation.branches ?? []).map((b) => ({
              label: b.label,
              when: b.when ?? '',
            })),
            position: operation.position ?? { x: 0, y: 0 },
            size: CLIENT_NODE_SIZE,
            pinned: Boolean(operation.position),
            order: nodes.length,
            origin: 'client',
            note: operation.note ?? '',
          });
          const after = operation.after ? resolve(operation.after) : undefined;
          if (after) nodes.splice(nodes.indexOf(after) + 1, 0, node);
          else nodes.push(node);
          renumber();
          break;
        }
        case 'update_node': {
          const node = resolve(operation.node);
          if (!node) throw new Error(`No box matching "${operation.node}".`);
          const next: ClientNode = { ...node };
          let reworded = false;
          if (operation.name !== undefined && operation.name.trim()) {
            reworded = reworded || next.name !== operation.name;
            next.name = operation.name.trim();
          }
          if (operation.description !== undefined) {
            reworded = reworded || next.description !== operation.description;
            next.description = operation.description;
          }
          if (operation.condition !== undefined) {
            reworded = reworded || next.condition !== operation.condition;
            next.condition = operation.condition;
          }
          if (operation.branches !== undefined) {
            reworded = true;
            next.branches = operation.branches.map((b) => ({ label: b.label, when: b.when ?? '' }));
          }
          if (operation.type !== undefined) next.type = operation.type;
          if (operation.note !== undefined) next.note = operation.note;
          // Only a box that stands for a block can be "reworded" — a box that
          // is only here has nothing to have diverged from.
          if (reworded && next.blockId) next.edited = true;
          nodes = nodes.map((n) => (n.id === node.id ? next : n));
          break;
        }
        case 'remove_node': {
          const node = resolve(operation.node);
          if (!node) throw new Error(`No box matching "${operation.node}".`);
          nodes = nodes.filter((n) => n.id !== node.id);
          for (const edge of edges) {
            if ((edge.source === node.id || edge.target === node.id) && edge.edgeId) {
              removed.push({ blockId: '', edgeId: edge.edgeId, name: edge.label, at: nowIso() });
            }
          }
          edges = edges.filter((e) => e.source !== node.id && e.target !== node.id);
          // A box standing for a block leaves a tombstone, so the next sync
          // does not quietly put it back and the removal can still be applied.
          if (node.blockId) {
            removed.push({ blockId: node.blockId, edgeId: '', name: node.name, at: nowIso() });
          }
          renumber();
          break;
        }
        case 'move_node': {
          const node = resolve(operation.node);
          if (!node) throw new Error(`No box matching "${operation.node}".`);
          nodes = nodes.map((n) =>
            n.id === node.id
              ? {
                  ...n,
                  position: { x: Math.round(operation.x), y: Math.round(operation.y) },
                  pinned: true,
                }
              : n,
          );
          break;
        }
        case 'add_edge': {
          const source = resolve(operation.source);
          const target = resolve(operation.target);
          if (!source) throw new Error(`No box matching "${operation.source}".`);
          if (!target) throw new Error(`No box matching "${operation.target}".`);
          if (source.id === target.id) throw new Error('An arrow needs two different boxes.');
          const exists = edges.some((e) => e.source === source.id && e.target === target.id);
          if (!exists) {
            edges.push(
              ClientEdgeSchema.parse({
                id: newId('cve'),
                source: source.id,
                target: target.id,
                type: operation.type ?? 'navigation',
                label: operation.label ?? '',
                condition: operation.condition ?? '',
                edgeId: null,
                origin: 'client',
              }),
            );
          }
          break;
        }
        case 'remove_edge': {
          const source = resolve(operation.source);
          const target = resolve(operation.target);
          if (!source || !target) throw new Error('Both ends of the arrow have to exist.');
          const going = edges.filter((e) => e.source === source.id && e.target === target.id);
          if (!going.length) throw new Error('There is no arrow between those two boxes.');
          for (const edge of going) {
            if (edge.edgeId) {
              removed.push({ blockId: '', edgeId: edge.edgeId, name: edge.label, at: nowIso() });
            }
          }
          edges = edges.filter((e) => !going.includes(e));
          break;
        }
        case 'reorder': {
          const wanted: ClientNode[] = [];
          for (const ref of operation.order) {
            const node = resolve(ref);
            if (node && !wanted.includes(node)) wanted.push(node);
          }
          nodes = [...wanted, ...nodes.filter((n) => !wanted.includes(n))];
          renumber();
          break;
        }
        case 'set_notes': {
          notes = operation.notes;
          break;
        }
      }
      applied += 1;
    } catch (err) {
      errors.push({
        index,
        op: operation.op,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  const next: ClientView = {
    ...view,
    nodes,
    edges,
    removed,
    notes,
    updatedAt: nowIso(),
  };
  return { view: layoutClientView(next), applied, errors };
}
