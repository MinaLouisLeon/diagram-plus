import { describe, expect, it } from 'vitest';
import {
  BLOCK_CATALOG,
  BLOCK_DATA_SCHEMAS,
  BLOCK_TYPES,
  BlockSchema,
  DiagramSchema,
  EDGE_TYPES,
  EDGE_TYPE_INFO,
  createBlock,
  createDiagram,
  migrate,
  parseDiagram,
  slugify,
  uniqueSlug,
} from '@diagram-plus/core';

describe('block schema', () => {
  it('fills in every default from a bare block', () => {
    const block = createBlock({ type: 'data_model', name: 'User' });
    expect(block.id).toMatch(/^blk_/);
    expect(block.data.fields).toEqual([]);
    expect(block.implementation.status).toBe('todo');
    expect(block.position).toEqual({ x: 0, y: 0 });
  });

  it('keeps the payload typed per block type', () => {
    const endpoint = createBlock({
      type: 'api_endpoint',
      name: 'Create order',
      data: { method: 'POST', path: '/api/orders' },
    });
    expect(endpoint.type).toBe('api_endpoint');
    if (endpoint.type === 'api_endpoint') {
      expect(endpoint.data.method).toBe('POST');
      expect(endpoint.data.auth).toBe('none');
      expect(endpoint.data.responses).toEqual([]);
    }
  });

  it('rejects a payload value the type does not allow', () => {
    expect(() =>
      createBlock({ type: 'api_endpoint', name: 'x', data: { method: 'FETCH' } }),
    ).toThrow();
  });

  it('names every block type in the catalog and the payload map', () => {
    for (const type of BLOCK_TYPES) {
      expect(BLOCK_CATALOG[type], `catalog entry for ${type}`).toBeDefined();
      expect(BLOCK_DATA_SCHEMAS[type], `payload schema for ${type}`).toBeDefined();
      expect(BLOCK_CATALOG[type].type).toBe(type);
    }
  });

  it('describes exactly the payload keys the schema accepts', () => {
    for (const type of BLOCK_TYPES) {
      const schemaKeys = Object.keys(BLOCK_DATA_SCHEMAS[type].shape).sort();
      const catalogKeys = BLOCK_CATALOG[type].fields.map((f) => f.key).sort();
      expect(catalogKeys, `catalog fields for ${type}`).toEqual(schemaKeys);
    }
  });

  it('gives every edge type a description and a style', () => {
    for (const type of EDGE_TYPES) {
      expect(EDGE_TYPE_INFO[type].description).not.toBe('');
      expect(['solid', 'dashed', 'dotted']).toContain(EDGE_TYPE_INFO[type].style);
    }
  });

  it('round-trips a diagram through JSON', () => {
    const diagram = createDiagram({ name: 'Round trip', projectGoal: 'test' });
    const parsed = parseDiagram(JSON.parse(JSON.stringify(diagram)));
    expect(parsed).toEqual(diagram);
  });

  it('rejects a block with no name', () => {
    expect(() => BlockSchema.parse({ id: 'blk_1', type: 'note', name: '' })).toThrow();
  });

  it('rejects a diagram with no id', () => {
    expect(() => DiagramSchema.parse({ name: 'x', slug: 'x' })).toThrow();
  });
});

describe('migration', () => {
  it('renames the v0 `nodes` array to `blocks`', () => {
    const migrated = migrate({ id: 'dgm_1', slug: 'x', name: 'x', nodes: [] }) as Record<string, unknown>;
    expect(migrated['blocks']).toEqual([]);
    expect(migrated['nodes']).toBeUndefined();
    expect(migrated['formatVersion']).toBe(1);
  });

  it('leaves a current document alone', () => {
    const diagram = createDiagram({ name: 'Current' });
    expect(migrate(diagram)).toEqual({ ...diagram });
  });
});

describe('slugs', () => {
  it('makes a filesystem-safe slug', () => {
    expect(slugify('Recipe Box!')).toBe('recipe-box');
    expect(slugify('  Héllo Wörld  ')).toBe('hello-world');
  });

  it('falls back when a name has nothing usable', () => {
    expect(slugify('!!!')).toMatch(/^diagram-/);
  });

  it('avoids collisions', () => {
    expect(uniqueSlug('shop', ['shop', 'shop-2'])).toBe('shop-3');
  });
});
