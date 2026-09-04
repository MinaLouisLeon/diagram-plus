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
