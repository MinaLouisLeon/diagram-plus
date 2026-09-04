import type { Diagram } from './diagram.js';
import type { Block, BlockType } from './blocks.js';
import { BLOCK_CATALOG } from './catalog.js';

/**
 * Turning a graph into an ordered plan.
 *
 * A diagram says what exists; implementing it needs an order. Data models come
 * before the services that read them, services before the endpoints that expose
 * them, endpoints before the screens that call them — with the graph breaking
 * ties inside each tier.
 */

const TIER: Record<BlockType, number> = {
  config: 0,
  data_model: 1,
  datastore: 1,
  external_service: 2,
  event: 2,
  service: 3,
  function: 3,
  job: 4,
  api_endpoint: 5,
  ui_component: 6,
  ui_screen: 7,
  decision: 8,
  loop: 8,
  note: 9,
  custom: 9,
};

export interface BuildPhase {
  index: number;
  label: string;
  blocks: Block[];
}

export interface BuildOrder {
  order: Block[];
  phases: BuildPhase[];
  /** Cycles found while ordering; each is a list of block names. */
  cycles: string[][];
}

const PHASE_LABELS: { tiers: number[]; label: string }[] = [
  { tiers: [0], label: 'Configuration' },
  { tiers: [1], label: 'Data layer' },
  { tiers: [2], label: 'Integrations' },
  { tiers: [3], label: 'Business logic' },
  { tiers: [4], label: 'Background work' },
  { tiers: [5], label: 'API surface' },
  { tiers: [6], label: 'UI components' },
  { tiers: [7], label: 'Screens' },
  { tiers: [8, 9], label: 'Flow notes' },
];

/** Edges that mean "the source needs the target to exist first". */
const NEEDS_FIRST = new Set(['calls', 'reads', 'writes', 'depends_on', 'renders', 'emits']);

export function buildOrder(diagram: Diagram): BuildOrder {
  const blocks = [...diagram.blocks];
  const byId = new Map(blocks.map((b) => [b.id, b]));

  const dependsOn = new Map<string, Set<string>>();
  for (const block of blocks) dependsOn.set(block.id, new Set());
  for (const edge of diagram.edges) {
    if (!NEEDS_FIRST.has(edge.type)) continue;
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    if (edge.source === edge.target) continue;
    dependsOn.get(edge.source)!.add(edge.target);
  }

  const order: Block[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const cycles: string[][] = [];

  const candidates = blocks.slice().sort((a, b) => {
    const tier = TIER[a.type] - TIER[b.type];
    return tier !== 0 ? tier : a.name.localeCompare(b.name);
  });

  const visit = (block: Block, stack: string[]): void => {
    const current = state.get(block.id);
    if (current === 'done') return;
    if (current === 'visiting') {
      const start = stack.indexOf(block.id);
      const names = stack
        .slice(start >= 0 ? start : 0)
        .map((id) => byId.get(id)?.name ?? id)
        .concat(block.name);
      cycles.push(names);
      return;
    }
    state.set(block.id, 'visiting');

    const deps = [...(dependsOn.get(block.id) ?? [])]
      .map((id) => byId.get(id))
      .filter((b): b is Block => Boolean(b))
      .sort((a, b) => TIER[a.type] - TIER[b.type] || a.name.localeCompare(b.name));

    for (const dep of deps) visit(dep, [...stack, block.id]);

    state.set(block.id, 'done');
    order.push(block);
  };

  for (const block of candidates) visit(block, []);

  const phases: BuildPhase[] = [];
  for (const phase of PHASE_LABELS) {
    const inPhase = order.filter((b) => phase.tiers.includes(TIER[b.type]));
    if (inPhase.length) {
      phases.push({ index: phases.length + 1, label: phase.label, blocks: inPhase });
    }
  }

  return { order, phases, cycles };
}

export interface DiagramStats {
  blocks: number;
  edges: number;
  byType: { type: BlockType; label: string; count: number }[];
  implemented: number;
  inProgress: number;
  todo: number;
  completion: number;
}

export function diagramStats(diagram: Diagram): DiagramStats {
  const counts = new Map<BlockType, number>();
  for (const block of diagram.blocks) {
    counts.set(block.type, (counts.get(block.type) ?? 0) + 1);
  }

  const implementable = diagram.blocks.filter((b) => b.type !== 'note');
  const implemented = implementable.filter((b) => b.implementation.status === 'done').length;
  const inProgress = implementable.filter((b) => b.implementation.status === 'in_progress').length;

  return {
    blocks: diagram.blocks.length,
    edges: diagram.edges.length,
    byType: [...counts.entries()]
      .map(([type, count]) => ({ type, label: BLOCK_CATALOG[type].label, count }))
      .sort((a, b) => b.count - a.count),
    implemented,
    inProgress,
    todo: implementable.length - implemented - inProgress,
    completion: implementable.length ? Math.round((implemented / implementable.length) * 100) : 0,
  };
}

/** Every block reachable from `start`, following edges forwards. */
export function downstreamOf(diagram: Diagram, start: string): Block[] {
  const byId = new Map(diagram.blocks.map((b) => [b.id, b]));
  const seen = new Set<string>([start]);
  const queue = [start];
  const out: Block[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    for (const edge of diagram.edges) {
      if (edge.source !== id || seen.has(edge.target)) continue;
      seen.add(edge.target);
      const block = byId.get(edge.target);
      if (block) {
        out.push(block);
        queue.push(edge.target);
      }
    }
  }
  return out;
}
