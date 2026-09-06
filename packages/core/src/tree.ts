import type { Diagram } from './diagram.js';
import type { Block, BlockType } from './blocks.js';
import type { ImplementationStatus } from './common.js';
import type { Edge } from './edges.js';

/**
 * The client view.
 *
 * A diagram is a graph, and a graph is the wrong shape to put in front of
 * someone who did not draw it. This turns the same file into a tree of what a
 * person can *do* in the application — screens, the actions on them, and the
 * conditions that decide what happens next — with the plumbing (endpoints,
 * services, tables) folded away rather than deleted.
 *
 * Two different things are called "conditions" here, and they do not interact:
 *
 * - a `TreeFilter` decides which blocks are allowed to appear at all;
 * - `decision` blocks and `conditional` / `error_flow` edges become readable
 *   branches *inside* the tree ("if the card is declined → …").
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

export interface OmittedBlock {
  blockId: string;
  name: string;
  reason: string;
}

export type TreeAudience = 'client' | 'technical';

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

/** The filter half of "with condition": what is allowed into the tree. */
export interface TreeFilter {
  /** Only these block types. Empty or absent means every type. */
  types?: BlockType[];
  /** Group ids or group names. */
  groups?: string[];
  /** Block must carry at least one of these tags. */
  tags?: string[];
  /** Only blocks in these implementation states. */
  status?: ImplementationStatus[];
  /** Case-insensitive match over name, summary and description. */
  search?: string;
}

export interface TreeOptions {
  /** `client` folds the plumbing away; `technical` keeps every block. */
  audience?: TreeAudience;
  filter?: TreeFilter;
  /** `groups` buckets the top level by group; `auto` does that only if groups exist. */
  roots?: 'auto' | 'flat' | 'groups';
  maxDepth?: number;
  /** Turn decisions and conditional edges into branches. */
  showConditions?: boolean;
  /** Let data models and datastores appear as leaves. */
  showData?: boolean;
}

interface ResolvedOptions {
  audience: TreeAudience;
  filter: TreeFilter;
  roots: 'auto' | 'flat' | 'groups';
  maxDepth: number;
  showConditions: boolean;
  showData: boolean;
}

export const DEFAULT_TREE_OPTIONS: ResolvedOptions = {
  audience: 'client',
  filter: {},
  roots: 'auto',
  maxDepth: 8,
  showConditions: true,
  showData: false,
};

function resolve(options: TreeOptions): ResolvedOptions {
  return { ...DEFAULT_TREE_OPTIONS, ...options, filter: options.filter ?? {} };
}

/* ------------------------------------------------------------------ *
 * What the reader is allowed to see
 * ------------------------------------------------------------------ */

/**
 * `render` — drawn as a node.
 * `fold`  — not drawn, but the walk carries on through it, and the step it
 *           stood for can still borrow its name ("Place the order").
 * `conduct` — the filter said no. The walk still passes through so the blocks
 *           on either side stay connected, but the block is never named.
 * `hide`  — neither drawn nor traversed.
 */
type Role = 'render' | 'fold' | 'conduct' | 'hide';

/** Block types a non-technical reader recognises as part of the product. */
const CLIENT_VISIBLE = new Set<BlockType>([
  'ui_screen',
  'decision',
  'job',
  'external_service',
]);

/**
 * `fold` is the interesting one: the block is not drawn, but the walk carries
 * on through it, so a screen that calls an endpoint that calls a service still
 * reaches whatever the service reaches.
 */
function audienceRole(block: Block, opts: ResolvedOptions): Role {
  if (block.type === 'note') return opts.audience === 'technical' ? 'render' : 'hide';
  if (block.type === 'data_model' || block.type === 'datastore') {
    return opts.showData || opts.audience === 'technical' ? 'render' : 'fold';
  }
  if (block.type === 'decision' && !opts.showConditions) return 'fold';
  if (opts.audience === 'technical') return 'render';
  return CLIENT_VISIBLE.has(block.type) ? 'render' : 'fold';
}

function matchesFilter(
  block: Block,
  filter: TreeFilter,
  groupNames: Map<string, string>,
): boolean {
  if (filter.types?.length && !filter.types.includes(block.type)) return false;
  if (filter.status?.length && !filter.status.includes(block.implementation.status)) return false;
  if (filter.tags?.length && !filter.tags.some((tag) => block.tags.includes(tag))) return false;
  if (filter.groups?.length) {
    const id = block.groupId ?? '';
    const name = id ? (groupNames.get(id) ?? '') : '';
    const hit = filter.groups.some((g) => g === id || g.toLowerCase() === name.toLowerCase());
    if (!hit) return false;
  }
  if (filter.search) {
    const needle = filter.search.toLowerCase();
    const hay = `${block.name} ${block.summary} ${block.description}`.toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * Reading a block out loud
 * ------------------------------------------------------------------ */

function kindOf(block: Block): TreeNodeKind {
  switch (block.type) {
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

const TRIGGER_PHRASE: Record<string, string> = {
  cron: 'Runs on a schedule',
  queue: 'Runs when work is queued',
  webhook: 'Runs when another system calls in',
  manual: 'Someone starts this by hand',
  startup: 'Runs when the system starts',
  event: 'Runs in response to something else',
};

/** One supporting line, in the plainest words the block has to offer. */
function plainDetail(block: Block, opts: ResolvedOptions): string {
  const fallback = block.summary || block.description;
  const technical = opts.audience === 'technical';
  switch (block.type) {
    case 'ui_screen':
      return block.data.purpose || fallback || (technical ? block.data.route : '');
    case 'ui_component':
      return block.data.purpose || fallback;
    case 'decision':
      return block.data.condition || fallback;
    case 'job': {
      const phrase = TRIGGER_PHRASE[block.data.trigger] ?? 'Runs automatically';
      const when = block.data.schedule ? `${phrase} (${block.data.schedule})` : phrase;
      return fallback ? `${when} — ${fallback}` : when;
    }
    case 'external_service':
      return block.data.provider ? `Handled by ${block.data.provider}` : fallback;
    case 'api_endpoint':
      return (
        block.data.summary ||
        fallback ||
        (technical ? `${block.data.method} ${block.data.path}` : '')
      );
    case 'service':
      return block.data.responsibility || fallback;
    case 'function':
      return block.data.steps[0] ?? fallback;
    case 'data_model': {
      const count = block.data.fields.length;
      if (fallback) return fallback;
      if (technical) return `${count} field${count === 1 ? '' : 's'}`;
      return `${count} piece${count === 1 ? '' : 's'} of information`;
    }
    case 'note':
      return block.data.text || fallback;
    default:
      return fallback;
  }
}

/** The guard on an edge, phrased so a renderer can put "If " in front of it. */
function conditionOf(edge: Edge, opts: ResolvedOptions): string {
  if (!opts.showConditions) return '';
  if (edge.type === 'conditional') return edge.condition || edge.label || '';
  if (edge.type === 'error_flow') return edge.condition || edge.label || 'something goes wrong';
  return '';
}

/**
 * What to call the step that goes through a folded block. A screen that
 * declares its own actions has already said it best, so prefer those.
 */
function stepLabel(source: Block, edge: Edge, hop: Block): string {
  if (source.type === 'ui_screen') {
    const action = source.data.actions.find(
      (a) => a.calls && a.calls.toLowerCase() === hop.name.toLowerCase(),
    );
    if (action) return action.name;
  }
  if (edge.label && edge.type !== 'conditional' && edge.type !== 'error_flow') return edge.label;
  return hop.name;
}

/* ------------------------------------------------------------------ *
 * The walk
 * ------------------------------------------------------------------ */

/** Edges in the order a reader wants them: what it shows, what it does, where it goes. */
const EDGE_ORDER: Record<string, number> = {
  renders: 0,
  calls: 1,
  conditional: 2,
  navigation: 3,
  emits: 4,
  listens: 5,
  writes: 6,
  reads: 7,
  data_flow: 8,
  depends_on: 9,
  error_flow: 10,
};

/**
 * One outgoing edge, resolved past any folded blocks.
 *
 * `hop` is the folded block immediately after the edge (null when the edge
 * lands on something the reader can already see); `targets` are the visible
 * blocks the walk reached through it, which may be empty when the path
 * dead-ends in plumbing — that dead end is still a real step and still earns a
 * node of its own.
 */
interface Slot {
  edge: Edge;
  hop: Block | null;
  via: Block[];
  targets: Block[];
}

export function buildProjectTree(diagram: Diagram, options: TreeOptions = {}): ProjectTree {
  const opts = resolve(options);
  const byId = new Map(diagram.blocks.map((b) => [b.id, b]));
  const groupNames = new Map(diagram.groups.map((g) => [g.id, g.name]));

  const omitted: OmittedBlock[] = [];
  const roles = new Map<string, Role>();
  for (const block of diagram.blocks) {
    const base = audienceRole(block, opts);
    if (base !== 'hide' && !matchesFilter(block, opts.filter, groupNames)) {
      if (base === 'render') {
        omitted.push({ blockId: block.id, name: block.name, reason: 'left out by the filter' });
      }
      roles.set(block.id, 'conduct');
      continue;
    }
    roles.set(block.id, base);
  }
  const roleOf = (block: Block): Role => roles.get(block.id) ?? 'fold';

  const outgoing = new Map<string, Edge[]>();
  for (const edge of diagram.edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    if (edge.source === edge.target) continue;
    const list = outgoing.get(edge.source);
    if (list) list.push(edge);
    else outgoing.set(edge.source, [edge]);
  }
  for (const list of outgoing.values()) {
    list.sort((a, b) => (EDGE_ORDER[a.type] ?? 99) - (EDGE_ORDER[b.type] ?? 99));
  }

  /** Breadth-first through folded blocks until visible ones are reached. */
  function reachThroughFolds(start: Block, from: string): { via: Block[]; targets: Block[] } {
    const via: Block[] = [];
    const targets: Block[] = [];
    const walked = new Set<string>([from, start.id]);
    const queue: Block[] = [start];
    while (queue.length) {
      const block = queue.shift()!;
      via.push(block);
      for (const edge of outgoing.get(block.id) ?? []) {
        const next = byId.get(edge.target);
        if (!next || walked.has(next.id)) continue;
        walked.add(next.id);
        const role = roleOf(next);
        if (role === 'hide') continue;
        if (role === 'render') targets.push(next);
        else queue.push(next);
      }
    }
    return { via, targets };
  }

  const slotCache = new Map<string, Slot[]>();
  function slotsFor(block: Block): Slot[] {
    const cached = slotCache.get(block.id);
    if (cached) return cached;
    const slots: Slot[] = [];
    for (const edge of outgoing.get(block.id) ?? []) {
      const target = byId.get(edge.target)!;
      const role = roleOf(target);
      if (role === 'hide') continue;
      if (role === 'render') {
        slots.push({ edge, hop: null, via: [], targets: [target] });
        continue;
      }
      const reached = reachThroughFolds(target, block.id);
      slots.push({ edge, hop: target, via: reached.via.slice(1), targets: reached.targets });
    }
    slotCache.set(block.id, slots);
    return slots;
  }

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
    if (roles.get(slot.hop.id) === 'conduct') {
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

  const visible = diagram.blocks.filter((b) => roleOf(b) === 'render');
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

  /** Where a reader wants to start: the product first, the machinery after. */
  const ROOT_PRIORITY: Record<TreeNodeKind, number> = {
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

  const readingOrder = (a: Block, b: Block): number =>
    ROOT_PRIORITY[kindOf(a)] - ROOT_PRIORITY[kindOf(b)] ||
    a.position.y - b.position.y ||
    a.position.x - b.position.x ||
    a.name.localeCompare(b.name);

  let entries = visible.filter((b) => (inDegree.get(b.id) ?? 0) === 0).sort(readingOrder);
  if (!entries.length && visible.length) {
    // Everything points at something else. Start from whatever leads the most.
    const best = [...visible].sort(
      (a, b) => slotsFor(b).length - slotsFor(a).length || readingOrder(a, b),
    )[0]!;
    entries = [best];
  }

  const rootNodes: { block: Block; node: TreeNode }[] = [];
  for (const block of entries) {
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

/**
 * Read tree options out of whatever the caller has: URL query parameters in
 * the server, `--flags` in the CLI, tool arguments in MCP. Keeping the spelling
 * in one place is what makes `?audience=technical` and `--audience technical`
 * mean the same thing.
 */
export function parseTreeOptions(read: (key: string) => string | null | undefined): TreeOptions {
  const value = (key: string): string | undefined => read(key)?.trim() || undefined;
  const flag = (key: string): boolean | undefined => {
    const raw = value(key);
    if (raw === undefined) return undefined;
    return !['false', '0', 'no', 'off'].includes(raw.toLowerCase());
  };
  const list = (key: string): string[] | undefined => {
    const raw = value(key);
    if (!raw) return undefined;
    const items = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return items.length ? items : undefined;
  };

  const options: TreeOptions = {};
  const audience = value('audience');
  if (audience === 'client' || audience === 'technical') options.audience = audience;

  const roots = value('roots');
  if (roots === 'auto' || roots === 'flat' || roots === 'groups') options.roots = roots;

  const depth = Number(value('depth'));
  if (Number.isFinite(depth) && depth > 0) options.maxDepth = Math.floor(depth);

  const conditions = flag('conditions');
  if (conditions !== undefined) options.showConditions = conditions;
  const data = flag('data');
  if (data !== undefined) options.showData = data;

  const filter: TreeFilter = {};
  const types = list('types');
  if (types) filter.types = types as BlockType[];
  const groups = list('groups');
  if (groups) filter.groups = groups;
  const tags = list('tags');
  if (tags) filter.tags = tags;
  const status = list('status');
  if (status) filter.status = status as ImplementationStatus[];
  const search = value('search');
  if (search) filter.search = search;
  if (Object.keys(filter).length) options.filter = filter;

  return options;
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
