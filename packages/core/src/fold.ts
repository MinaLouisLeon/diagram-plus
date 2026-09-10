import { z } from 'zod';
import type { Diagram } from './diagram.js';
import type { Block, BlockType } from './blocks.js';
import { BlockTypeSchema } from './blocks.js';
import { ImplementationStatusSchema, type ImplementationStatus } from './common.js';
import type { Edge } from './edges.js';

/**
 * Folding: the rule for which blocks a reader is shown, and how the walk gets
 * past the ones they are not.
 *
 * A diagram is a graph of everything the application is made of. Two views are
 * built on top of it — the tree in `tree.ts` and the client canvas in
 * `client-view.ts` — and both need the same answer to the same question: given
 * an audience and a filter, which blocks are drawn, which are plumbing to be
 * walked through, and what should the step through that plumbing be called.
 *
 * Two different things are called "conditions" here, and they do not interact:
 *
 * - a `TreeFilter` decides which blocks are allowed to appear at all;
 * - `decision` blocks and `conditional` / `error_flow` edges become readable
 *   branches *inside* the view ("if the card is declined → …").
 */

export type TreeAudience = 'client' | 'technical';

/** The filter half of "with condition": what is allowed into the view. */
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

export interface ResolvedTreeOptions {
  audience: TreeAudience;
  filter: TreeFilter;
  roots: 'auto' | 'flat' | 'groups';
  maxDepth: number;
  showConditions: boolean;
  showData: boolean;
}

export const DEFAULT_TREE_OPTIONS: ResolvedTreeOptions = {
  audience: 'client',
  filter: {},
  roots: 'auto',
  maxDepth: 8,
  showConditions: true,
  showData: false,
};

export function resolveTreeOptions(options: TreeOptions): ResolvedTreeOptions {
  return { ...DEFAULT_TREE_OPTIONS, ...options, filter: options.filter ?? {} };
}

/** The stored form, so a saved client view remembers how it was built. */
export const TreeFilterSchema = z.object({
  types: z.array(BlockTypeSchema).optional(),
  groups: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  status: z.array(ImplementationStatusSchema).optional(),
  search: z.string().optional(),
});

export const TreeOptionsSchema = z.object({
  audience: z.enum(['client', 'technical']).optional(),
  filter: TreeFilterSchema.optional(),
  roots: z.enum(['auto', 'flat', 'groups']).optional(),
  maxDepth: z.number().int().positive().optional(),
  showConditions: z.boolean().optional(),
  showData: z.boolean().optional(),
});

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
export type Role = 'render' | 'fold' | 'conduct' | 'hide';

/** Block types a non-technical reader recognises as part of the product. */
const CLIENT_VISIBLE = new Set<BlockType>(['ui_screen', 'decision', 'job', 'external_service']);

/**
 * `fold` is the interesting one: the block is not drawn, but the walk carries
 * on through it, so a screen that calls an endpoint that calls a service still
 * reaches whatever the service reaches.
 */
export function audienceRole(block: Block, opts: ResolvedTreeOptions): Role {
  if (block.type === 'note') return opts.audience === 'technical' ? 'render' : 'hide';
  if (block.type === 'data_model' || block.type === 'datastore') {
    return opts.showData || opts.audience === 'technical' ? 'render' : 'fold';
  }
  if (block.type === 'decision' && !opts.showConditions) return 'fold';
  if (opts.audience === 'technical') return 'render';
  return CLIENT_VISIBLE.has(block.type) ? 'render' : 'fold';
}

export function matchesFilter(
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

export interface OmittedBlock {
  blockId: string;
  name: string;
  reason: string;
}

/* ------------------------------------------------------------------ *
 * Reading a block out loud
 * ------------------------------------------------------------------ */

const TRIGGER_PHRASE: Record<string, string> = {
  cron: 'Runs on a schedule',
  queue: 'Runs when work is queued',
  webhook: 'Runs when another system calls in',
  manual: 'Someone starts this by hand',
  startup: 'Runs when the system starts',
  event: 'Runs in response to something else',
};

/** One supporting line, in the plainest words the block has to offer. */
export function plainDetail(block: Block, opts: ResolvedTreeOptions): string {
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
export function conditionOf(edge: Edge, opts: ResolvedTreeOptions): string {
  if (!opts.showConditions) return '';
  if (edge.type === 'conditional') return edge.condition || edge.label || '';
  if (edge.type === 'error_flow') return edge.condition || edge.label || 'something goes wrong';
  return '';
}

/**
 * What to call the step that goes through a folded block. A screen that
 * declares its own actions has already said it best, so prefer those.
 */
export function stepLabel(source: Block, edge: Edge, hop: Block): string {
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
 * The folded graph
 * ------------------------------------------------------------------ */

/** Edges in the order a reader wants them: what it shows, what it does, where it goes. */
export const EDGE_ORDER: Record<string, number> = {
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
 * dead-ends in plumbing — that dead end is still a real step.
 */
export interface Slot {
  edge: Edge;
  hop: Block | null;
  via: Block[];
  targets: Block[];
}

export interface FoldedGraph {
  opts: ResolvedTreeOptions;
  byId: Map<string, Block>;
  roleOf: (block: Block) => Role;
  /** Blocks drawn for this audience and filter, in canvas order. */
  visible: Block[];
  /** Outgoing edges, already sorted into reading order. */
  slotsFor: (block: Block) => Slot[];
  /** Blocks the filter removed — so nothing disappears without being counted. */
  omitted: OmittedBlock[];
}

/**
 * Decide the role of every block and resolve every outgoing edge past the
 * folded ones. Both views are built from exactly this.
 */
export function foldDiagram(diagram: Diagram, options: TreeOptions = {}): FoldedGraph {
  const opts = resolveTreeOptions(options);
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

  return {
    opts,
    byId,
    roleOf,
    visible: diagram.blocks.filter((b) => roleOf(b) === 'render'),
    slotsFor,
    omitted,
  };
}

/**
 * Read view options out of whatever the caller has: URL query parameters in
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
