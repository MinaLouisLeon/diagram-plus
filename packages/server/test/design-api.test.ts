import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { startServer, type RunningServer } from '@diagram-plus/server';
import type { DesignDocument } from '@diagram-plus/core';

/**
 * The design routes, over a real socket — so routing, the sibling file on
 * disk, the revision check and the live broadcast are all covered rather than
 * just the functions underneath them.
 */

let server: RunningServer;
let root: string;
let base: string;

interface DesignBody {
  design: DesignDocument;
  saved?: boolean;
  changes?: { undesigned: { name: string }[]; orphaned: { name: string }[] };
  progress?: { completion: number; danglingActions: unknown[] };
  result?: { applied: number; errors: unknown[] };
  report?: { added: string[]; orphaned: string[] };
}

async function call<T>(
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${base}${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as T };
}

const designFile = (slug: string): string => path.join(root, '.diagrams', `${slug}.design.json`);

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'diagram-plus-design-api-'));
  server = await startServer({ root, port: 0, assetsDir: path.join(root, 'no-assets') });
  base = server.url;

  await call('POST', '/api/diagrams', { name: 'Shop', projectGoal: 'Sell things.' });
  await call('POST', '/api/diagrams/shop/batch', {
    operations: [
      {
        op: 'add_block',
        block: {
          type: 'ui_screen',
          name: 'Login',
          data: {
            route: '/login',
            purpose: 'Sign in',
            state: [{ name: 'email', type: 'string', required: true }],
            actions: [{ name: 'Sign in', calls: 'POST /api/session' }],
          },
        },
      },
      {
        op: 'add_block',
        block: { type: 'ui_screen', name: 'Products', data: { route: '/products' } },
      },
    ],
  });
});

afterAll(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true });
});

describe('the design routes', () => {
  it('offers the design palette alongside the block catalog', async () => {
    const { body } = await call<{ elementTypes: unknown[]; elementCategories: unknown[] }>(
      'GET',
      '/api/catalog',
    );
    expect(body.elementTypes.length).toBeGreaterThan(20);
    expect(body.elementCategories).toHaveLength(4);
  });

  it('derives designs on read without writing a file', async () => {
    const { status, body } = await call<DesignBody>('GET', '/api/diagrams/shop/design');
    expect(status).toBe(200);
    expect(body.design.screens.map((s) => s.name)).toEqual(['Login', 'Products']);
    expect(body.saved).toBe(false);
    // Looking at the designs must not create anything on disk.
    expect(await exists(designFile('shop'))).toBe(false);
  });

  it('seeds the wireframes from the diagram, wired to what it already knows', async () => {
    const { body } = await call<DesignBody>('POST', '/api/diagrams/shop/design/sync', {});
    expect(body.report?.added).toEqual(['Login', 'Products']);
    expect(await exists(designFile('shop'))).toBe(true);

    const login = body.design.screens.find((s) => s.name === 'Login')!;
    const flat = JSON.stringify(login.root);
    expect(flat).toContain('state.email');
    expect(flat).toContain('POST /api/session');
  });

  it('applies operations and reports the ones that fail', async () => {
    const { body } = await call<DesignBody>('POST', '/api/diagrams/shop/design/ops', {
      operations: [
        { op: 'add_element', screen: 'Products', type: 'search', props: { placeholder: 'Search' } },
        { op: 'remove_element', screen: 'Products', element: 'nothing called this' },
      ],
    });
    expect(body.result?.applied).toBe(1);
    expect(body.result?.errors).toHaveLength(1);
    expect(JSON.stringify(body.design)).toContain('Search');
  });

  it('replaces the whole document but never lets the payload change its identity', async () => {
    const before = (await call<DesignBody>('GET', '/api/diagrams/shop/design')).body.design;

    const { body } = await call<DesignBody>('PUT', '/api/diagrams/shop/design', {
      design: { ...before, slug: 'somewhere-else', diagramId: 'forged', notes: 'Reviewed.' },
    });
    expect(body.design.notes).toBe('Reviewed.');
    expect(body.design.slug).toBe('shop');
    expect(body.design.diagramId).toBe(before.diagramId);
  });

  it('refuses a write that was overtaken', async () => {
    const current = (await call<DesignBody>('GET', '/api/diagrams/shop/design')).body.design;
    const { status } = await call('PUT', '/api/diagrams/shop/design', {
      design: current,
      expectedRevision: current.revision - 1,
    });
    expect(status).toBe(409);
  });

  it('rejects something that is not a design document', async () => {
    const { status } = await call('PUT', '/api/diagrams/shop/design', { design: { nope: true } });
    expect(status).toBe(400);
  });

  it('keeps drawn screens when the diagram changes, and flags the ones whose block has gone', async () => {
    await call('POST', '/api/diagrams/shop/design/ops', {
      operations: [
        {
          op: 'set_tree',
          screen: 'Login',
          root: { type: 'stack', children: [{ type: 'heading', text: 'Hand-written' }] },
        },
      ],
    });

    await call('POST', '/api/diagrams/shop/batch', {
      operations: [
        { op: 'add_block', block: { type: 'ui_screen', name: 'Basket' } },
        { op: 'delete_block', block: 'Products' },
      ],
    });

    const { body } = await call<DesignBody>('POST', '/api/diagrams/shop/design/sync', {});
    expect(body.report?.added).toEqual(['Basket']);
    expect(body.report?.orphaned).toEqual(['Products']);

    const login = body.design.screens.find((s) => s.name === 'Login')!;
    expect(login.root.children[0]!.text).toBe('Hand-written');
  });

  it('folds the designs into the implementation spec', async () => {
    const { body } = await call<{ markdown: string }>('GET', '/api/diagrams/shop/spec');
    expect(body.markdown).toContain('## Design system');
    expect(body.markdown).toContain('Hand-written');

    const without = await call<{ markdown: string }>('GET', '/api/diagrams/shop/spec?design=false');
    expect(without.body.markdown).not.toContain('Hand-written');
  });

  it('arranges the artboards without touching what is on them', async () => {
    const before = (await call<DesignBody>('GET', '/api/diagrams/shop/design')).body.design;
    const { body } = await call<DesignBody>('POST', '/api/diagrams/shop/design/layout', {
      includePinned: true,
    });
    expect(body.design.screens.map((s) => s.name)).toEqual(before.screens.map((s) => s.name));
    expect(JSON.stringify(body.design.screens.map((s) => s.root))).toBe(
      JSON.stringify(before.screens.map((s) => s.root)),
    );
  });

  it('tells open editors when the designs change', async () => {
    const socket = new WebSocket(`${base.replace('http', 'ws')}/ws`);
    const message = new Promise<{ type: string; slug: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no design:changed frame arrived')), 5000);
      socket.on('message', (raw) => {
        const frame = JSON.parse(String(raw)) as { type: string; slug: string };
        if (frame.type !== 'design:changed') return;
        clearTimeout(timer);
        resolve(frame);
      });
      socket.on('error', reject);
    });

    await new Promise<void>((resolve) => socket.on('open', () => resolve()));
    await call('POST', '/api/diagrams/shop/design/ops', {
      operations: [{ op: 'set_notes', notes: 'Broadcast me.' }],
    });

    expect((await message).slug).toBe('shop');
    socket.close();
  });

  it('deletes the designs with the diagram', async () => {
    expect(await exists(designFile('shop'))).toBe(true);
    await call('DELETE', '/api/diagrams/shop');
    expect(await exists(designFile('shop'))).toBe(false);
  });

  it('404s for a diagram that is not there', async () => {
    const { status } = await call('GET', '/api/diagrams/nope/design');
    expect(status).toBe(404);
  });
});
