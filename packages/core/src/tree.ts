import type { Diagram } from './diagram.js';
import type { Block, BlockType } from './blocks.js';
import type { Edge } from './edges.js';
import {
  conditionOf,
  foldDiagram,
  plainDetail,
  stepLabel,
  type OmittedBlock,
  type Slot,
  type TreeAudience,
  type TreeOptions,
} from './fold.js';

/**
 * The client view, as a tree.
 *
 * A diagram is a graph, and a graph is the wrong shape to read aloud. This
 * turns the same file into a tree of what a person can *do* in the application
 * — screens, the actions on them, and the conditions that decide what happens
 * next — with the plumbing (endpoints, services, tables) folded away rather
 * than deleted.
 *
 * Which blocks are folded, and what the step through them is called, is
 * decided in `fold.ts` and shared with the client canvas, so the two views
 * never disagree about what a client is being shown.
 */

export const TREE_NODE_KINDS = [
  'section',
  'screen',
  'shows',
  'action',
  'question',
  'branch',
  'automation',
  'integration',
  'data',
  'note',
  'repeat',
] as const;

export type TreeNodeKind = (typeof TREE_NODE_KINDS)[number];

export interface TreeNode {
  /** Unique within one tree. */
  id: string;
  kind: TreeNodeKind;
  /** Plain language, no ids, no routes. */
  label: string;
  /** One supporting line, or ''. */
  detail: string;
  /** Guard that had to hold to get here, e.g. "the card is declined". */
  condition: string;
  /** The block this came from, so the editor can select it on the canvas. */
  blockId: string | null;
  /** Technical blocks folded into this step. Shown only to a technical reader. */
  via: string[];
  children: TreeNode[];
}

export interface ProjectTree {
  name: string;
  description: string;
  audience: TreeAudience;
  roots: TreeNode[];
  /** Blocks the filter removed — so nothing disappears without being counted. */
  omitted: OmittedBlock[];
  nodeCount: number;
  /** True when the walk hit `maxDepth` somewhere. */
  truncated: boolean;
}

/** What kind of thing a block reads as, once the jargon is gone. */
export function kindOf(block: Block): TreeNodeKind {
  return kindOfType(block.type);
}

export function kindOfType(type: BlockType): TreeNodeKind {
  switch (type) {
    case 'ui_screen':
      return 'screen';
    case 'ui_component':
      return 'shows';
    case 'decision':
      return 'question';
    case 'job':
      return 'automation';
    case 'external_service':
      return 'integration';
    case 'data_model':
    case 'datastore':
      return 'data';
    case 'note':
      return 'note';
    default:
      return 'action';
  }
}

/** Where a reader wants to start: the product first, the machinery after. */
export const ROOT_PRIORITY: Record<TreeNodeKind, number> = {
  screen: 0,
  question: 1,
  shows: 2,
  action: 3,
  automation: 4,
  integration: 5,
  data: 6,
  note: 7,
  branch: 8,
  repeat: 9,
  section: 9,
};

/** Canvas reading order, with the product-facing blocks pulled to the front. */
export function readingOrder(a: Block, b: Block): number {
  return (
    ROOT_PRIORITY[kindOf(a)] - ROOT_PRIORITY[kindOf(b)] ||
    a.position.y - b.position.y ||
    a.position.x - b.position.x ||
    a.name.localeCompare(b.name)
  );
}

/**
 * Where a walk of the folded graph should start: the visible blocks nothing
 * else leads to. Shared with the client canvas so both views open on the same
 * screen.
 */
export function entryBlocks(fold: {
  visible: Block[];
  slotsFor: (block: Block) => Slot[];
}): Block[] {
  const { visible, slotsFor } = fold;
  const inDegree = new Map<string, number>(visible.map((b) => [b.id, 0]));
  for (const block of visible) {
    for (const slot of slotsFor(block)) {
      // An error path pointing back at the front door does not make the front
      // door someone's second step, so it does not disqualify it as a start.
      if (slot.edge.type === 'error_flow') continue;
      for (const target of slot.targets) {
        if (target.id === block.id) continue;
        inDegree.set(target.id, (inDegree.get(target.id) ?? 0) + 1);
      }
    }
  }

  const entries = visible.filter((b) => (inDegree.get(b.id) ?? 0) === 0).sort(readingOrder);
  if (!entries.length && visible.length) {
    // Everything points at something else. Start from whatever leads the most.
    const best = [...visible].sort(
      (a, b) => slotsFor(b).length - slotsFor(a).length || readingOrder(a, b),
    )[0]!;
    return [best];
  }
  return entries;
}

export function buildProjectTree(diagram: Diagram, options: TreeOptions = {}): ProjectTree {
  const fold = foldDiagram(diagram, options);
  const { opts, roleOf, slotsFor, visible, omitted } = fold;

  let counter = 0;
  const nextId = (): string => `n${counter++}`;
  const seen = new Set<string>();
  let truncated = false;

  interface Context {
    condition: string;
    detail?: string;
    via: string[];
  }

  function walk(block: Block, ctx: Context, depth: number, path: Set<string>): TreeNode {
    const node: TreeNode = {
      id: nextId(),
      kind: kindOf(block),
      label: block.name,
      detail: ctx.detail || plainDetail(block, opts),
      condition: ctx.condition,
      blockId: block.id,
      via: ctx.via,
      children: [],
    };

    // A graph loops and a tree cannot. The second sighting of a block is a
    // pointer back to the first, which is also what stops a dense diagram
    // exploding into thousands of duplicated branches.
    if (path.has(block.id) || seen.has(block.id)) {
      node.kind = 'repeat';
      return node;
    }
    if (depth >= opts.maxDepth) {
      truncated = true;
      return node;
    }

    seen.add(block.id);
    const nextPath = new Set(path).add(block.id);
    node.children = expand(block, depth + 1, nextPath);
    return node;
  }

  function nodesForSlot(
    source: Block,
    slot: Slot,
    condition: string,
    depth: number,
    path: Set<string>,
    detail?: string,
  ): TreeNode[] {
    // Straight to something the reader can see: no wrapper needed.
    if (!slot.hop) {
      return [walk(slot.targets[0]!, { condition, detail, via: [] }, depth, path)];
    }
    // The filter removed this hop, so it does not get to name the step. Hand
    // back whatever it leads to instead.
    if (roleOf(slot.hop) === 'conduct') {
      return slot.targets.map((target) =>
        walk(target, { condition, detail, via: slot.via.map((b) => b.name) }, depth, path),
      );
    }

    const wrapper: TreeNode = {
      id: nextId(),
      kind: slot.edge.type === 'renders' ? 'shows' : 'action',
      label: stepLabel(source, slot.edge, slot.hop),
      detail: detail || plainDetail(slot.hop, opts),
      condition,
      blockId: slot.hop.id,
      via: slot.via.map((b) => b.name),
      children: [],
    };
    if (depth >= opts.maxDepth) {
      truncated = true;
      return [wrapper];
    }
    for (const target of slot.targets) {
      wrapper.children.push(walk(target, { condition: '', via: [] }, depth + 1, path));
    }
    return [wrapper];
  }

  /**
   * A decision is the whole reason this view exists: it is where the diagram
   * already holds the branching in words. Each declared branch is matched to
   * the conditional edge that carries it out, so the label the user wrote and
   * the wire they drew end up on the same line.
   */
  function expandDecision(block: Block, depth: number, path: Set<string>): TreeNode[] {
    if (block.type !== 'decision') return [];
    const slots = slotsFor(block);
    const used = new Set<Edge>();
    const children: TreeNode[] = [];

    for (const branch of block.data.branches) {
      const wanted = branch.label.trim().toLowerCase();
      const slot = slots.find((s) => {
        if (used.has(s.edge)) return false;
        const text = `${s.edge.label} ${s.edge.condition}`.trim().toLowerCase();
        return text === wanted || (wanted.length > 2 && text.includes(wanted));
      });
      const condition = opts.showConditions ? branch.when || branch.label : '';
      const reached = slot
        ? nodesForSlot(block, slot, condition, depth, path, branch.description)
        : [];
      if (slot) used.add(slot.edge);
      if (reached.length) {
        children.push(...reached);
      } else {
        // The branch was written down but nothing was wired to it — or what it
        // led to has been filtered away. Either way the outcome still counts.
        children.push({
          id: nextId(),
          kind: 'branch',
          label: branch.label,
          detail: branch.description,
          condition,
          blockId: null,
          via: [],
          children: [],
        });
      }
    }

    for (const slot of slots) {
      if (used.has(slot.edge)) continue;
      children.push(...nodesForSlot(block, slot, conditionOf(slot.edge, opts), depth, path));
    }
    return children;
  }

  function expand(block: Block, depth: number, path: Set<string>): TreeNode[] {
    if (block.type === 'decision' && opts.showConditions) {
      return expandDecision(block, depth, path);
    }
    return slotsFor(block).flatMap((slot) =>
      nodesForSlot(block, slot, conditionOf(slot.edge, opts), depth, path),
    );
  }

  /* ---- roots ----------------------------------------------------- */

  const rootNodes: { block: Block; node: TreeNode }[] = [];
  for (const block of entryBlocks(fold)) {
    if (seen.has(block.id)) continue;
    rootNodes.push({ block, node: walk(block, { condition: '', via: [] }, 0, new Set()) });
  }
  // Anything marooned in a cycle that no entry point reaches still has to appear.
  for (const block of [...visible].sort(readingOrder)) {
    if (seen.has(block.id)) continue;
    rootNodes.push({ block, node: walk(block, { condition: '', via: [] }, 0, new Set()) });
  }

  const useGroups =
    opts.roots === 'groups' ||
    (opts.roots === 'auto' && rootNodes.some(({ block }) => block.groupId));

  let roots: TreeNode[];
  if (useGroups) {
    const sections = new Map<string, TreeNode>();
    const order: string[] = [];
    for (const { block, node } of rootNodes) {
      const key = block.groupId ?? '';
      let section = sections.get(key);
      if (!section) {
        const group = key ? diagram.groups.find((g) => g.id === key) : undefined;
        section = {
          id: nextId(),
          kind: 'section',
          label: group?.name ?? 'Everything else',
          detail: group?.description ?? '',
          condition: '',
          blockId: null,
          via: [],
          children: [],
        };
        sections.set(key, section);
        order.push(key);
      }
      section.children.push(node);
    }
    // Named groups first, in the order they are declared; the leftovers last.
    const groupIndex = (key: string): number => {
      if (!key) return Number.MAX_SAFE_INTEGER;
      const at = diagram.groups.findIndex((g) => g.id === key);
      return at < 0 ? Number.MAX_SAFE_INTEGER - 1 : at;
    };
    order.sort((a, b) => groupIndex(a) - groupIndex(b));
    roots = order.map((key) => sections.get(key)!);
  } else {
    roots = rootNodes.map((r) => r.node);
  }

  let nodeCount = 0;
  const count = (nodes: TreeNode[]): void => {
    for (const node of nodes) {
      nodeCount += 1;
      count(node.children);
    }
  };
  count(roots);

  return {
    name: diagram.name,
    description: diagram.description,
    audience: opts.audience,
    roots,
    omitted,
    nodeCount,
    truncated,
  };
}

/** Depth-first walk over a built tree — handy for the editor and the renderers. */
export function walkTree(
  tree: ProjectTree,
  visit: (node: TreeNode, depth: number, parent: TreeNode | null) => void,
): void {
  const step = (nodes: TreeNode[], depth: number, parent: TreeNode | null): void => {
    for (const node of nodes) {
      visit(node, depth, parent);
      step(node.children, depth + 1, node);
    }
  };
  step(tree.roots, 0, null);
}
