import { describe, expect, it } from 'vitest';
import {
  addBlocks,
  addEdges,
  createDiagram,
  createEdge,
  validateDiagram,
} from '@diagram-plus/core';

const codes = (diagram: Parameters<typeof validateDiagram>[0]) =>
  validateDiagram(diagram).issues.map((i) => i.code);

describe('validation', () => {
  it('flags a connection pointing at a block that is gone', () => {
    const diagram = createDiagram({ name: 'Dangling' });
    addBlocks(diagram, [{ type: 'note', name: 'Only block' }]);
    diagram.edges.push(createEdge({ source: diagram.blocks[0]!.id, target: 'blk_missing' }));

    const result = validateDiagram(diagram);
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('dangling_edge_target');
  });

  it('warns when a relationship makes no sense for those block types', () => {
    const diagram = createDiagram({ name: 'Odd' });
    addBlocks(diagram, [
      { type: 'data_model', name: 'User', data: { fields: [{ name: 'id' }] } },
      { type: 'ui_screen', name: 'Home', data: { route: '/' } },
    ]);
    addEdges(diagram, [{ source: 'User', target: 'Home', type: 'navigation' }]);
    expect(codes(diagram)).toContain('edge_source_type');
  });

  it('accepts a sensible relationship without complaint', () => {
    const diagram = createDiagram({ name: 'Sensible', projectGoal: 'ship it' });
    addBlocks(diagram, [
      { type: 'data_model', name: 'User', data: { fields: [{ name: 'id' }] } },
      { type: 'service', name: 'UserService', data: { functions: [{ name: 'find' }] } },
    ]);
    addEdges(diagram, [{ source: 'UserService', target: 'User', type: 'reads' }]);
    expect(validateDiagram(diagram).warnings).toEqual([]);
  });

  it('warns about a block with nothing filled in', () => {
    const diagram = createDiagram({ name: 'Empty block' });
    addBlocks(diagram, [{ type: 'data_model', name: 'Ghost' }]);
    expect(codes(diagram)).toContain('block_incomplete');
  });

  it('does not ask a note to be filled in', () => {
    const diagram = createDiagram({ name: 'Notes' });
    addBlocks(diagram, [{ type: 'note', name: 'Reminder' }]);
    expect(codes(diagram)).not.toContain('block_incomplete');
  });

  it('warns about two blocks of a kind sharing a name', () => {
    const diagram = createDiagram({ name: 'Twins' });
    addBlocks(diagram, [
      { type: 'service', name: 'Service', data: { functions: [{ name: 'a' }] } },
      { type: 'service', name: 'service', data: { functions: [{ name: 'b' }] } },
    ]);
    expect(codes(diagram)).toContain('duplicate_name');
  });

  it('warns when a model relates to something that is not in the diagram', () => {
    const diagram = createDiagram({ name: 'Relation' });
    addBlocks(diagram, [
      {
        type: 'data_model',
        name: 'Order',
        data: { fields: [{ name: 'id' }], relations: [{ to: 'Customer' }] },
      },
    ]);
    expect(codes(diagram)).toContain('unknown_relation_target');
  });

  it('mentions a block nothing connects to', () => {
    const diagram = createDiagram({ name: 'Orphan' });
    addBlocks(diagram, [
      { type: 'service', name: 'A', data: { functions: [{ name: 'x' }] } },
      { type: 'service', name: 'B', data: { functions: [{ name: 'y' }] } },
    ]);
    expect(codes(diagram)).toContain('orphan_block');
  });

  it('notices an empty diagram and a missing goal', () => {
    const diagram = createDiagram({ name: 'Nothing' });
    expect(codes(diagram)).toEqual(expect.arrayContaining(['empty_diagram', 'no_project_goal']));
  });
});
