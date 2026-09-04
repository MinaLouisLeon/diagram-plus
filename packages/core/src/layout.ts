import type { Diagram } from './diagram.js';
import type { Block } from './blocks.js';
import { defaultSizeFor } from './factory.js';

/**
 * Layered auto-layout.
 *
 * Diagrams built by Claude arrive with every block at (0,0), so the first thing
 * a user sees has to be readable without touching it. Blocks are pushed into
 * layers by dependency depth, ordered within a layer to cut crossings, then
 * placed on a grid.
 */

export type LayoutDirection = 'LR' | 'TB';

export interface LayoutOptions {
  direction?: LayoutDirection;
  /** Gap between layers. */
  layerGap?: number;
  /** Gap between blocks inside a layer. */
  blockGap?: number;
  originX?: number;
  originY?: number;
}

const DEFAULTS: Required<LayoutOptions> = {
  direction: 'LR',
  layerGap: 140,
  blockGap: 48,
  originX: 80,
  originY: 80,
};

/** Edge kinds that express "A needs B", used to order the layers. */
const DEPENDENCY_EDGES = new Set([
  'calls',
  'reads',
  'writes',
  'depends_on',
  'renders',
  'emits',
  'data_flow',
  'navigation',
  'conditional',
  'listens',
  'error_flow',
]);

function assignLayers(diagram: Diagram): Map<string, number> {
  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();

  for (const block of diagram.blocks) {
    outgoing.set(block.id, []);
    indegree.set(block.id, 0);
  }
  for (const edge of diagram.edges) {
    if (!DEPENDENCY_EDGES.has(edge.type)) continue;
    if (!outgoing.has(edge.source) || !indegree.has(edge.target)) continue;
    if (edge.source === edge.target) continue;
    outgoing.get(edge.source)!.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  // Kahn's algorithm; anything left over is in a cycle and gets placed after.
  const layer = new Map<string, number>();
  const queue: string[] = [];
  for (const [id, deg] of indegree) {
    if (deg === 0) {
      layer.set(id, 0);
      queue.push(id);
    }
  }

  const remaining = new Map(indegree);
  while (queue.length) {
    const id = queue.shift()!;
    const current = layer.get(id) ?? 0;
    for (const next of outgoing.get(id) ?? []) {
      layer.set(next, Math.max(layer.get(next) ?? 0, current + 1));
      const deg = (remaining.get(next) ?? 1) - 1;
      remaining.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }

  // Cycles: place each unresolved block just after its deepest placed source.
  for (const block of diagram.blocks) {
    if (layer.has(block.id)) continue;
    const sources = diagram.edges
      .filter((e) => e.target === block.id && DEPENDENCY_EDGES.has(e.type))
      .map((e) => layer.get(e.source))
      .filter((n): n is number => typeof n === 'number');
    layer.set(block.id, sources.length ? Math.max(...sources) + 1 : 0);
  }

  return layer;
}

/** One barycentre pass: pull each block towards the average of its neighbours. */
function orderWithinLayers(
  diagram: Diagram,
  layers: Map<number, Block[]>,
  layerOf: Map<string, number>,
): void {
  const indexOf = new Map<string, number>();
  const refreshIndices = () => {
    for (const blocks of layers.values()) {
      blocks.forEach((b, i) => indexOf.set(b.id, i));
    }
  };
  refreshIndices();

  const neighbours = new Map<string, string[]>();
  for (const block of diagram.blocks) neighbours.set(block.id, []);
  for (const edge of diagram.edges) {
    if (!neighbours.has(edge.source) || !neighbours.has(edge.target)) continue;
    neighbours.get(edge.source)!.push(edge.target);
    neighbours.get(edge.target)!.push(edge.source);
  }

  const sortedLayerKeys = [...layers.keys()].sort((a, b) => a - b);
  for (let pass = 0; pass < 4; pass++) {
    for (const key of sortedLayerKeys) {
      const blocks = layers.get(key)!;
      const score = new Map<string, number>();
      for (const block of blocks) {
        const others = (neighbours.get(block.id) ?? []).filter(
          (id) => layerOf.get(id) !== key && indexOf.has(id),
        );
        score.set(
          block.id,
          others.length
            ? others.reduce((sum, id) => sum + (indexOf.get(id) ?? 0), 0) / others.length
            : (indexOf.get(block.id) ?? 0),
        );
      }
      blocks.sort((a, b) => (score.get(a.id) ?? 0) - (score.get(b.id) ?? 0));
      refreshIndices();
    }
  }
}

export function autoLayout(diagram: Diagram, options: LayoutOptions = {}): Diagram {
  const opts = { ...DEFAULTS, ...options };
  if (diagram.blocks.length === 0) return diagram;

  const layerOf = assignLayers(diagram);
  const layers = new Map<number, Block[]>();
  for (const block of diagram.blocks) {
    const key = layerOf.get(block.id) ?? 0;
    const list = layers.get(key) ?? [];
    list.push(block);
    layers.set(key, list);
  }

  // Stable starting order so layout is deterministic for the same input.
  for (const blocks of layers.values()) {
    blocks.sort((a, b) => a.name.localeCompare(b.name));
  }
  orderWithinLayers(diagram, layers, layerOf);

  const horizontal = opts.direction === 'LR';
  const sortedKeys = [...layers.keys()].sort((a, b) => a - b);

  // Size of each layer along the cross axis, so layers can be centred.
  const crossExtents = sortedKeys.map((key) => {
    const blocks = layers.get(key)!;
    return blocks.reduce((sum, b) => {
      const size = b.size ?? defaultSizeFor(b.type);
      return sum + (horizontal ? size.height : size.width) + opts.blockGap;
    }, -opts.blockGap);
  });
  const maxCross = Math.max(0, ...crossExtents);

  let mainOffset = horizontal ? opts.originX : opts.originY;

  sortedKeys.forEach((key, layerIndex) => {
    const blocks = layers.get(key)!;
    const layerMain = blocks.reduce((max, b) => {
      const size = b.size ?? defaultSizeFor(b.type);
      return Math.max(max, horizontal ? size.width : size.height);
    }, 0);

    const extent = crossExtents[layerIndex] ?? 0;
    let cross =
      (horizontal ? opts.originY : opts.originX) + Math.max(0, (maxCross - extent) / 2);

    for (const block of blocks) {
      const size = block.size ?? defaultSizeFor(block.type);
      if (horizontal) {
        block.position = { x: mainOffset, y: Math.round(cross) };
        cross += size.height + opts.blockGap;
      } else {
        block.position = { x: Math.round(cross), y: mainOffset };
        cross += size.width + opts.blockGap;
      }
    }

    mainOffset += layerMain + opts.layerGap;
  });

  return diagram;
}
