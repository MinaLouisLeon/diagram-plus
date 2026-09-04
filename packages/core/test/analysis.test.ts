import { describe, expect, it } from 'vitest';
import {
  addBlocks,
  addEdges,
  autoLayout,
  buildOrder,
  createDiagram,
  diagramStats,
  downstreamOf,
  markImplemented,
  type Diagram,
} from '@diagram-plus/core';

function stack(): Diagram {
  const diagram = createDiagram({ name: 'Stack' });
  addBlocks(diagram, [
    { type: 'ui_screen', name: 'Home', data: { route: '/' } },
    { type: 'api_endpoint', name: 'Get items', data: { method: 'GET', path: '/api/items' } },
    { type: 'service', name: 'ItemService', data: { functions: [{ name: 'list' }] } },
    { type: 'data_model', name: 'Item', data: { fields: [{ name: 'id' }] } },
    { type: 'config', name: 'Env', data: { keys: [{ name: 'DATABASE_URL' }] } },
  ]);
  addEdges(diagram, [
    { source: 'Home', target: 'Get items', type: 'calls' },
    { source: 'Get items', target: 'ItemService', type: 'calls' },
    { source: 'ItemService', target: 'Item', type: 'reads' },
  ]);
  return diagram;
}

describe('build order', () => {
  it('puts the data layer before the screens that depend on it', () => {
    const order = buildOrder(stack()).order.map((b) => b.name);
    expect(order.indexOf('Item')).toBeLessThan(order.indexOf('ItemService'));
    expect(order.indexOf('ItemService')).toBeLessThan(order.indexOf('Get items'));
    expect(order.indexOf('Get items')).toBeLessThan(order.indexOf('Home'));
  });

  it('groups the work into labelled phases', () => {
    const phases = buildOrder(stack()).phases.map((p) => p.label);
    expect(phases).toEqual([
      'Configuration',
      'Data layer',
      'Business logic',
      'API surface',
      'Screens',
    ]);
  });

  it('reports a cycle instead of looping forever', () => {
    const diagram = createDiagram({ name: 'Cycle' });
    addBlocks(diagram, [
      { type: 'service', name: 'A', data: { functions: [{ name: 'a' }] } },
      { type: 'service', name: 'B', data: { functions: [{ name: 'b' }] } },
    ]);
    addEdges(diagram, [
      { source: 'A', target: 'B', type: 'calls' },
      { source: 'B', target: 'A', type: 'calls' },
    ]);
    const result = buildOrder(diagram);
    expect(result.cycles.length).toBeGreaterThan(0);
    expect(result.order).toHaveLength(2);
  });
});

describe('stats', () => {
  it('counts progress across implementable blocks', () => {
    const diagram = stack();
    markImplemented(diagram, { block: 'Item' });
    markImplemented(diagram, { block: 'ItemService', status: 'in_progress' });

    const stats = diagramStats(diagram);
    expect(stats.blocks).toBe(5);
    expect(stats.implemented).toBe(1);
    expect(stats.inProgress).toBe(1);
    expect(stats.todo).toBe(3);
    expect(stats.completion).toBe(20);
  });
});

describe('layout', () => {
  it('places dependencies to the right of what needs them', () => {
    const diagram = autoLayout(stack(), { direction: 'LR' });
    const at = (name: string) => diagram.blocks.find((b) => b.name === name)!.position;
    expect(at('Home').x).toBeLessThan(at('Get items').x);
    expect(at('Get items').x).toBeLessThan(at('ItemService').x);
    expect(at('ItemService').x).toBeLessThan(at('Item').x);
  });

  it('stacks vertically when asked', () => {
    const diagram = autoLayout(stack(), { direction: 'TB' });
    const at = (name: string) => diagram.blocks.find((b) => b.name === name)!.position;
    expect(at('Home').y).toBeLessThan(at('Item').y);
  });

  it('never leaves two blocks on top of each other', () => {
    const diagram = autoLayout(stack());
    const seen = new Set(diagram.blocks.map((b) => `${b.position.x},${b.position.y}`));
    expect(seen.size).toBe(diagram.blocks.length);
  });

  it('handles an empty diagram', () => {
    expect(() => autoLayout(createDiagram({ name: 'Empty' }))).not.toThrow();
  });
});

describe('downstream', () => {
  it('follows connections forwards', () => {
    const diagram = stack();
    const home = diagram.blocks.find((b) => b.name === 'Home')!;
    expect(downstreamOf(diagram, home.id).map((b) => b.name)).toEqual([
      'Get items',
      'ItemService',
      'Item',
    ]);
  });
});
