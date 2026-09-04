import { describe, expect, it } from 'vitest';
import {
  addBlocks,
  addEdges,
  applyBatch,
  createDiagram,
  deleteBlocks,
  markImplemented,
  updateBlock,
  updateEdge,
  type Diagram,
} from '@diagram-plus/core';

function seeded(): Diagram {
  const diagram = createDiagram({ name: 'Seed' });
  addBlocks(diagram, [
    { type: 'data_model', name: 'User', data: { fields: [{ name: 'id', type: 'uuid' }] } },
    { type: 'service', name: 'UserService' },
    { type: 'ui_screen', name: 'Profile', data: { route: '/profile' } },
  ]);
  addEdges(diagram, [
    { source: 'Profile', target: 'UserService', type: 'calls' },
    { source: 'UserService', target: 'User', type: 'reads' },
  ]);
  return diagram;
}

describe('operations', () => {
  it('connects blocks referred to by name', () => {
    const diagram = seeded();
    expect(diagram.edges).toHaveLength(2);
    const [first] = diagram.edges;
    expect(first?.source).toMatch(/^blk_/);
    expect(diagram.blocks.find((b) => b.id === first?.source)?.name).toBe('Profile');
  });

  it('refuses to connect a block that does not exist, and says which', () => {
    const diagram = seeded();
    expect(() => addEdges(diagram, [{ source: 'Ghost', target: 'User' }])).toThrow(/Ghost/);
  });

  it('does not create the same connection twice', () => {
    const diagram = seeded();
    addEdges(diagram, [{ source: 'UserService', target: 'User', type: 'reads' }]);
    expect(diagram.edges).toHaveLength(2);
  });

  it('merges payload keys on update and leaves the rest alone', () => {
    const diagram = seeded();
    updateBlock(diagram, 'User', { data: { tableName: 'users' } });
    const user = diagram.blocks.find((b) => b.name === 'User');
    expect(user?.type).toBe('data_model');
    if (user?.type === 'data_model') {
      expect(user.data.tableName).toBe('users');
      expect(user.data.fields).toHaveLength(1);
    }
  });

  it('replaces the payload when asked to', () => {
    const diagram = seeded();
    updateBlock(diagram, 'User', { data: { tableName: 'users' }, replaceData: true });
    const user = diagram.blocks.find((b) => b.name === 'User');
    if (user?.type === 'data_model') expect(user.data.fields).toHaveLength(0);
  });

  it('deletes a block together with its connections', () => {
    const diagram = seeded();
    const result = deleteBlocks(diagram, ['UserService']);
    expect(result.deletedBlocks).toHaveLength(1);
    expect(result.deletedEdges).toHaveLength(2);
    expect(diagram.edges).toHaveLength(0);
    expect(diagram.blocks).toHaveLength(2);
  });

  it('reports blocks it could not find rather than throwing', () => {
    const diagram = seeded();
    expect(deleteBlocks(diagram, ['Ghost']).notFound).toEqual(['Ghost']);
  });

  it('changes a connection type', () => {
    const diagram = seeded();
    const edge = diagram.edges[0]!;
    expect(updateEdge(diagram, edge.id, { type: 'navigation' }).type).toBe('navigation');
  });

  it('records implementation progress and can append files', () => {
    const diagram = seeded();
    markImplemented(diagram, { block: 'User', files: ['src/db/user.ts'] });
    markImplemented(diagram, { block: 'User', files: ['src/db/user.test.ts'], appendFiles: true });
    const user = diagram.blocks.find((b) => b.name === 'User');
    expect(user?.implementation.status).toBe('done');
    expect(user?.implementation.files).toEqual(['src/db/user.ts', 'src/db/user.test.ts']);
  });
});

describe('applyBatch', () => {
  it('lets later operations refer to blocks created earlier by name', () => {
    const diagram = createDiagram({ name: 'Batch' });
    const result = applyBatch(diagram, [
      { op: 'add_block', block: { type: 'data_model', name: 'Order' } },
      { op: 'add_block', block: { type: 'api_endpoint', name: 'Create order' } },
      { op: 'add_edge', edge: { source: 'Create order', target: 'Order', type: 'writes' } },
    ]);
    expect(result.applied).toBe(3);
    expect(result.errors).toEqual([]);
    expect(diagram.edges).toHaveLength(1);
  });

  it('applies what it can and reports the operations that failed', () => {
    const diagram = createDiagram({ name: 'Partial' });
    const result = applyBatch(diagram, [
      { op: 'add_block', block: { type: 'note', name: 'Fine' } },
      { op: 'add_edge', edge: { source: 'Missing', target: 'Fine' } },
      { op: 'add_block', block: { type: 'note', name: 'Also fine' } },
    ]);
    expect(result.applied).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.index).toBe(1);
    expect(diagram.blocks).toHaveLength(2);
  });

  it('sets the diagram status', () => {
    const diagram = createDiagram({ name: 'Status' });
    applyBatch(diagram, [{ op: 'set_status', status: 'ready' }]);
    expect(diagram.status).toBe('ready');
  });
});
