import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { startServer, type RunningServer } from '@diagram-plus/server';

/**
 * The API is exercised over a real socket rather than by calling handlers, so
 * routing, JSON encoding and the WebSocket broadcast are all covered.
 */

let server: RunningServer;
let root: string;
let base: string;

async function call<T>(method: string, url: string, body?: unknown): Promise<{ status: number; body: T }> {
  const response = await fetch(`${base}${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as T };
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'diagram-plus-api-'));
  server = await startServer({ root, port: 0, assetsDir: path.join(root, 'no-assets') });
  base = server.url;
});

afterAll(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true });
});

describe('the REST API', () => {
  it('reports where it is looking for diagrams', async () => {
    const { body } = await call<{ ok: boolean; directory: string }>('GET', '/api/health');
    expect(body.ok).toBe(true);
    expect(body.directory).toBe(path.join(root, '.diagrams'));
  });

  it('serves the block catalog the editor is built from', async () => {
    const { body } = await call<{ blockTypes: unknown[]; edgeTypes: unknown[] }>('GET', '/api/catalog');
    expect(body.blockTypes).toHaveLength(15);
    expect(body.edgeTypes).toHaveLength(11);
  });

  it('creates, reads and lists a diagram', async () => {
    const created = await call<{ diagram: { slug: string } }>('POST', '/api/diagrams', {
      name: 'API Test',
      projectGoal: 'Prove the API works.',
    });
    expect(created.status).toBe(200);
    expect(created.body.diagram.slug).toBe('api-test');

    const read = await call<{ diagram: { projectGoal: string } }>('GET', '/api/diagrams/api-test');
    expect(read.body.diagram.projectGoal).toBe('Prove the API works.');

    const list = await call<{ diagrams: unknown[] }>('GET', '/api/diagrams');
    expect(list.body.diagrams).toHaveLength(1);
  });

  it('refuses to create a diagram with no name', async () => {
    const { status } = await call('POST', '/api/diagrams', { name: '  ' });
    expect(status).toBe(400);
  });

  it('applies a batch of changes and writes them to disk', async () => {
    const { status, body } = await call<{ diagram: { revision: number; blocks: unknown[] } }>(
      'POST',
      '/api/diagrams/api-test/batch',
      {
        operations: [
          { op: 'add_block', block: { type: 'data_model', name: 'Thing', data: { fields: [{ name: 'id' }] } } },
          { op: 'add_block', block: { type: 'ui_screen', name: 'Things', data: { route: '/things' } } },
          { op: 'add_edge', edge: { source: 'Things', target: 'Thing', type: 'reads' } },
        ],
        layout: true,
      },
    );
    expect(status).toBe(200);
    expect(body.diagram.blocks).toHaveLength(2);

    const file = path.join(root, '.diagrams', 'api-test.diagram.json');
    const onDisk = JSON.parse(await readFile(file, 'utf8')) as { blocks: unknown[]; edges: unknown[] };
    expect(onDisk.blocks).toHaveLength(2);
    expect(onDisk.edges).toHaveLength(1);
  });

  it('rejects a write based on a revision that has moved on', async () => {
    const { status } = await call('POST', '/api/diagrams/api-test/batch', {
      operations: [],
      expectedRevision: 1,
    });
    expect(status).toBe(409);
  });

  it('returns the spec, the validation report and the stats', async () => {
    const spec = await call<{ markdown: string }>('GET', '/api/diagrams/api-test/spec');
    expect(spec.body.markdown).toContain('Prove the API works.');

    const validation = await call<{ validation: { valid: boolean } }>(
      'GET',
      '/api/diagrams/api-test/validate',
    );
    expect(validation.body.validation.valid).toBe(true);

    const stats = await call<{ stats: { blocks: number }; phases: unknown[] }>(
      'GET',
      '/api/diagrams/api-test/stats',
    );
    expect(stats.body.stats.blocks).toBe(2);
    expect(stats.body.phases.length).toBeGreaterThan(0);
  });

  it('exports Mermaid', async () => {
    const { body } = await call<{ content: string }>(
      'GET',
      '/api/diagrams/api-test/export?format=mermaid',
    );
    expect(body.content).toContain('flowchart LR');
  });

  it('refuses an unknown export format', async () => {
    const { status } = await call('GET', '/api/diagrams/api-test/export?format=pdf');
    expect(status).toBe(400);
  });

  it('exports the client view, with the plumbing folded away', async () => {
    const { body } = await call<{ content: string }>(
      'GET',
      '/api/diagrams/api-test/export?format=tree',
    );
    expect(body.content).toContain('Things');
    // The data model is behind a `reads`, which a client does not need to see.
    expect(body.content).not.toContain('pieces of information');

    const withData = await call<{ content: string }>(
      'GET',
      '/api/diagrams/api-test/export?format=tree&data=true',
    );
    expect(withData.body.content).toContain('Thing');
  });

  it('serves the client view as data, shaped by query parameters', async () => {
    const plain = await call<{ tree: { roots: unknown[]; audience: string; omitted: unknown[] } }>(
      'GET',
      '/api/diagrams/api-test/tree',
    );
    expect(plain.body.tree.audience).toBe('client');
    expect(plain.body.tree.roots).toHaveLength(1);

    const technical = await call<{ tree: { audience: string } }>(
      'GET',
      '/api/diagrams/api-test/tree?audience=technical',
    );
    expect(technical.body.tree.audience).toBe('technical');

    const filtered = await call<{ tree: { omitted: { name: string }[] } }>(
      'GET',
      '/api/diagrams/api-test/tree?data=true&types=ui_screen',
    );
    expect(filtered.body.tree.omitted.map((o) => o.name)).toContain('Thing');
  });

  it('replaces a whole diagram, which is how undo works', async () => {
    const before = await call<{ diagram: Record<string, unknown> }>('GET', '/api/diagrams/api-test');
    const snapshot = { ...before.body.diagram, blocks: [], edges: [] };
    const { status, body } = await call<{ diagram: { blocks: unknown[] } }>(
      'PUT',
      '/api/diagrams/api-test',
      { diagram: snapshot },
    );
    expect(status).toBe(200);
    expect(body.diagram.blocks).toHaveLength(0);
  });

  it('rejects a replacement that is not a valid diagram', async () => {
    const { status } = await call('PUT', '/api/diagrams/api-test', { diagram: { name: 'broken' } });
    expect(status).toBe(400);
  });

  it('renames a diagram and moves its file', async () => {
    const { body } = await call<{ diagram: { slug: string; name: string } }>(
      'PATCH',
      '/api/diagrams/api-test',
      { name: 'Renamed' },
    );
    expect(body.diagram.slug).toBe('renamed');
    const list = await call<{ diagrams: { slug: string }[] }>('GET', '/api/diagrams');
    expect(list.body.diagrams.map((d) => d.slug)).toEqual(['renamed']);
  });

  it('404s for a diagram that is not there', async () => {
    expect((await call('GET', '/api/diagrams/ghost')).status).toBe(404);
  });

  it('404s for an unknown API route', async () => {
    expect((await call('GET', '/api/nothing-here')).status).toBe(404);
  });

  it('deletes a diagram', async () => {
    expect((await call('DELETE', '/api/diagrams/renamed')).status).toBe(200);
    const list = await call<{ diagrams: unknown[] }>('GET', '/api/diagrams');
    expect(list.body.diagrams).toHaveLength(0);
  });
});

describe('live updates', () => {
  it('tells open editors when a diagram changes, whoever changed it', async () => {
    const socket = new WebSocket(`${base.replace('http', 'ws')}/ws`);
    const messages: Record<string, unknown>[] = [];
    socket.on('message', (data) => messages.push(JSON.parse(String(data)) as Record<string, unknown>));
    await new Promise((resolve) => socket.on('open', resolve));

    await call('POST', '/api/diagrams', { name: 'Live' });
    await new Promise((resolve) => setTimeout(resolve, 300));

    // An edit made straight to the file, as the MCP server does.
    const file = path.join(root, '.diagrams', 'live.diagram.json');
    const doc = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    doc['revision'] = (doc['revision'] as number) + 1;
    doc['description'] = 'changed on disk';
    await writeFile(file, JSON.stringify(doc, null, 2));

    await new Promise((resolve) => setTimeout(resolve, 1200));
    socket.close();

    expect(messages[0]?.['type']).toBe('hello');
    const external = messages.find(
      (m) => m['source'] === 'external' && (m['diagram'] as { description?: string })?.description === 'changed on disk',
    );
    expect(external, 'an external file edit should reach the editor').toBeDefined();
  });
});

describe('importing a diagram from elsewhere', () => {
  interface DiagramBody {
    diagram: {
      id: string;
      slug: string;
      name: string;
      revision: number;
      description: string;
      blocks: unknown[];
    };
  }

  it('replaces the local diagram in place, keeping its identity', async () => {
    const created = await call<DiagramBody>('POST', '/api/diagrams', { name: 'Handoff' });
    const mine = created.body.diagram;

    // What comes back from someone who has the app but not this repository.
    const theirs = { ...mine, name: 'Handoff reviewed', description: 'edited elsewhere', revision: 84 };

    const imported = await call<DiagramBody & { replaced: string | null }>(
      'POST',
      '/api/diagrams/import',
      { diagram: theirs, action: 'replace', target: mine.slug },
    );

    expect(imported.status).toBe(200);
    expect(imported.body.replaced).toBe('handoff');
    expect(imported.body.diagram.id).toBe(mine.id);
    expect(imported.body.diagram.slug).toBe('handoff');
    expect(imported.body.diagram.description).toBe('edited elsewhere');
    // Ours plus one, not theirs.
    expect(imported.body.diagram.revision).toBe(mine.revision + 1);

    const list = await call<{ diagrams: { slug: string }[] }>('GET', '/api/diagrams');
    expect(list.body.diagrams.filter((d) => d.slug.startsWith('handoff'))).toHaveLength(1);
  });

  it('adds a copy alongside instead, when asked', async () => {
    const created = await call<DiagramBody>('POST', '/api/diagrams', { name: 'Keep Both' });
    const mine = created.body.diagram;

    const imported = await call<DiagramBody>('POST', '/api/diagrams/import', {
      diagram: { ...mine, description: 'the other one' },
      action: 'copy',
    });

    expect(imported.body.diagram.slug).toBe('keep-both-imported');
    expect(imported.body.diagram.id).not.toBe(mine.id);

    const original = await call<DiagramBody>('GET', '/api/diagrams/keep-both');
    expect(original.body.diagram.description).toBe('');
  });

  it('will not overwrite anything by omission', async () => {
    const created = await call<DiagramBody>('POST', '/api/diagrams', { name: 'Careful' });

    const noAction = await call<{ error: string }>('POST', '/api/diagrams/import', {
      diagram: created.body.diagram,
    });
    expect(noAction.status).toBe(400);

    const noTarget = await call<{ error: string }>('POST', '/api/diagrams/import', {
      diagram: created.body.diagram,
      action: 'replace',
    });
    expect(noTarget.status).toBe(400);
    expect(noTarget.body.error).toMatch(/target/);
  });

  it('rejects a file that is not a diagram', async () => {
    const { status, body } = await call<{ error: string }>('POST', '/api/diagrams/import', {
      diagram: { hello: 'world' },
      action: 'copy',
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/not a diagram/);
  });
});
