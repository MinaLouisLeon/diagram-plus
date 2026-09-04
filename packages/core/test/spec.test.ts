import { describe, expect, it } from 'vitest';
import {
  addBlocks,
  addEdges,
  createDiagram,
  exportDiagram,
  generateBlockSpec,
  generateSpec,
  toMermaid,
  type Diagram,
} from '@diagram-plus/core';

function shop(): Diagram {
  const diagram = createDiagram({
    name: 'Shop',
    projectGoal: 'Sell handmade things online.',
    techStack: { language: 'TypeScript', database: 'PostgreSQL' },
  });
  diagram.status = 'ready';
  addBlocks(diagram, [
    {
      type: 'data_model',
      name: 'Product',
      data: {
        tableName: 'products',
        fields: [
          { name: 'id', type: 'uuid', required: true },
          { name: 'price', type: 'integer', required: true, description: 'In minor units' },
        ],
        indexes: ['products_slug_idx'],
      },
    },
    {
      type: 'api_endpoint',
      name: 'List products',
      data: {
        method: 'GET',
        path: '/api/products',
        auth: 'none',
        responses: [{ status: 200, description: 'All products' }],
        errors: [{ status: 500, code: 'internal', when: 'The database is unreachable' }],
      },
    },
    {
      type: 'function',
      name: 'formatPrice',
      data: {
        params: [{ name: 'minorUnits', type: 'integer', required: true }],
        returns: 'string',
        steps: ['divide by 100', 'format with the currency symbol'],
        throws: ['RangeError when negative'],
      },
    },
    {
      type: 'config',
      name: 'Environment',
      data: { keys: [{ name: 'DATABASE_URL', required: true, secret: true }] },
    },
  ]);
  addEdges(diagram, [{ source: 'List products', target: 'Product', type: 'reads' }]);
  return diagram;
}

describe('the implementation spec', () => {
  const spec = generateSpec(shop());

  it('leads with the goal and the stack', () => {
    expect(spec).toContain('# Shop — implementation spec');
    expect(spec).toContain('Sell handmade things online.');
    expect(spec).toContain('**Language:** TypeScript');
  });

  it('gives the work an order', () => {
    expect(spec).toContain('## Build order');
    expect(spec.indexOf('Configuration')).toBeLessThan(spec.indexOf('Data layer'));
  });

  it('spells out every field of a data model', () => {
    expect(spec).toContain('`products`');
    expect(spec).toContain('| `price` | `integer` | yes | In minor units |');
    expect(spec).toContain('products_slug_idx');
  });

  it('spells out an endpoint, its responses and its errors', () => {
    expect(spec).toContain('GET /api/products');
    expect(spec).toContain('**Response 200** All products');
    expect(spec).toContain('The database is unreachable');
  });

  it('writes a function out as numbered pseudo-code', () => {
    expect(spec).toContain('1. divide by 100');
    expect(spec).toContain('2. format with the currency symbol');
    expect(spec).toContain('RangeError when negative');
  });

  it('lists the connections between blocks', () => {
    expect(spec).toContain('## All connections');
    expect(spec).toContain('| List products | reads | Product |');
  });

  it('warns loudly when the diagram is still a draft', () => {
    const draft = shop();
    draft.status = 'draft';
    expect(generateSpec(draft)).toContain('still a draft');
    expect(spec).not.toContain('still a draft');
  });

  it('names the gaps rather than hiding them', () => {
    const gappy = createDiagram({ name: 'Gappy' });
    addBlocks(gappy, [{ type: 'data_model', name: 'Unfinished' }]);
    expect(generateSpec(gappy)).toContain('Open questions and gaps');
  });

  it('can describe a single block on its own', () => {
    const diagram = shop();
    const block = diagram.blocks.find((b) => b.name === 'formatPrice')!;
    const focused = generateBlockSpec(diagram, block);
    expect(focused).toContain('# formatPrice');
    expect(focused).toContain('divide by 100');
    expect(focused).not.toContain('List products');
  });
});

describe('exports', () => {
  it('renders Mermaid that names every block and connection', () => {
    const diagram = shop();
    const mermaid = toMermaid(diagram);
    expect(mermaid.startsWith('flowchart LR')).toBe(true);
    expect(mermaid).toContain('Product');
    expect(mermaid).toContain('"reads"');
    for (const block of diagram.blocks) {
      expect(mermaid).toContain(block.id.replace(/[^a-zA-Z0-9_]/g, '_'));
    }
  });

  it('leaves a dangling connection out of the drawing', () => {
    const diagram = shop();
    diagram.edges[0]!.target = 'blk_missing';
    expect(toMermaid(diagram)).not.toContain('blk_missing');
  });

  it('exports valid JSON', () => {
    const diagram = shop();
    expect(JSON.parse(exportDiagram(diagram, 'json')).name).toBe('Shop');
  });

  it('exports a Markdown document with the picture in it', () => {
    expect(exportDiagram(shop(), 'markdown')).toContain('```mermaid');
  });
});
