import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DesignStore, DiagramStore, NodeDiagramFs } from '@diagram-plus/core';
import { createMcpServer } from '@diagram-plus/mcp';

/**
 * The screen-design tools, driven through a real MCP client — so the wire
 * schemas, the argument validation and the text a model actually reads back
 * are all under test, not just the core functions underneath.
 */

let store: DiagramStore;
let designs: DesignStore;
let client: Client;
let root: string;

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  return { text: result.content.map((c) => c.text).join('\n'), isError: result.isError === true };
}

/** A diagram with two screens, one of them carrying state and actions. */
async function seedDiagram() {
  await call('create_diagram_from_outline', {
    name: 'Shop',
    projectGoal: 'Sell things',
    blocks: [
      {
        type: 'ui_screen',
        name: 'Login',
        data: {
          route: '/login',
          purpose: 'Sign in to the shop',
          layout: 'centred form',
          state: [
            { name: 'email', type: 'string', required: true, example: 'you@example.com' },
            { name: 'password', type: 'string', required: true },
          ],
          actions: [{ name: 'Sign in', calls: 'POST /api/session' }],
        },
      },
      {
        type: 'ui_screen',
        name: 'Products',
        data: { route: '/products', purpose: 'Browse the catalogue', layout: 'grid of cards' },
      },
      { type: 'api_endpoint', name: 'Create session', data: { method: 'POST', path: '/api/session' } },
    ],
    edges: [{ source: 'Login', target: 'Create session', type: 'calls' }],
  });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'diagram-plus-design-'));
  const fs = new NodeDiagramFs({ root });
  store = new DiagramStore({ root });
  designs = new DesignStore(fs);
  const server = createMcpServer({ store, designs, editorUrl: 'http://localhost:4517' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

afterEach(async () => {
  await client.close();
  await rm(root, { recursive: true, force: true });
});

describe('the design tools', () => {
  it('exposes them all', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const expected of [
      'describe_design_schema',
      'read_screen_design',
      'design_screen',
      'update_screen_design',
      'set_design_system',
      'sync_screen_designs',
      'arrange_screen_designs',
      'design_progress',
    ]) {
      expect(names, `tool ${expected}`).toContain(expected);
    }
  });

  it('describes how a screen is written, with its rules and an example', async () => {
    const { text } = await call('describe_design_schema');
    expect(text).toContain('data-binding');
    expect(text).toContain('data-navigates-to');
    expect(text).toContain('var(--color-accent)');
    expect(text).toContain('.text-heading-lg');
    // The rules and a worked example travel with it, so a screen can be drawn
    // without a second round-trip.
    expect(text).toContain('Write real HTML');
    expect(text).toContain('<table data-repeat="Patient"');
  });

  it('seeds a wireframe per screen, already wired to the diagram', async () => {
    await seedDiagram();
    const { text, isError } = await call('sync_screen_designs', { diagram: 'shop' });
    expect(isError).toBe(false);
    expect(text).toContain('Login');
    expect(text).toContain('Products');

    const read = await call('read_screen_design', { diagram: 'shop', screen: 'Login' });
    // Every hook the block knew about came across.
    expect(read.text).toContain('value ← state.email');
    expect(read.text).toContain('does → POST /api/session');
    expect(read.text).toContain('/login');
    // The layout hint on the Products block became a grid.
    const products = await call('read_screen_design', { diagram: 'shop', screen: 'Products' });
    expect(products.text).toContain('grid');
  });

  it('reading never writes a design file; editing does', async () => {
    await seedDiagram();
    await call('read_screen_design', { diagram: 'shop' });
    expect(await designs.exists('shop')).toBe(false);

    await call('sync_screen_designs', { diagram: 'shop' });
    expect(await designs.exists('shop')).toBe(true);
    const file = await readFile(path.join(root, '.diagrams', 'shop.design.json'), 'utf8');
    expect(JSON.parse(file).screens.length).toBe(2);
  });

  it('designs a screen from markup, minting an id for every element', async () => {
    await seedDiagram();
    await call('sync_screen_designs', { diagram: 'shop' });

    const { text } = await call('design_screen', {
      diagram: 'shop',
      screen: 'Login',
      purpose: 'Sign in to the shop',
      html: `<main class="screen">
        <h1 class="text-heading-lg">Welcome back</h1>
        <form class="col">
          <label>Email<input data-binding="state.email" required></label>
          <button class="btn primary" data-action="POST /api/session">Sign in</button>
        </form>
      </main>`,
    });

    expect(text).toContain('Designed **Login**');
    expect(text).toContain('value \u2190 state.email');
    expect(text).toContain('does \u2192 POST /api/session');

    const design = await designs.read('shop');
    const login = design.screens.find((s) => s.name === 'Login')!;
    expect(login.status).toBe('drafted');
    expect(login.html).toContain('Welcome back');

    // Every element is addressable, which is what the editor needs from it.
    const ids = [...login.html.matchAll(/data-el="(els_[a-z0-9]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(4);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('sets tokens and reports them back', async () => {
    await seedDiagram();
    const { text, isError } = await call('set_design_system', {
      diagram: 'shop',
      system: {
        voice: 'Warm and confident.',
        colors: [{ name: 'accent', value: '#7c3aed', on: '#ffffff', description: 'Buy buttons.' }],
      },
    });
    expect(isError).toBe(false);
    expect(text).toContain('#7c3aed');
    expect((await designs.read('shop')).system.voice).toBe('Warm and confident.');
  });

  it('applies precise edits and reports the ones that fail', async () => {
    await seedDiagram();
    await call('sync_screen_designs', { diagram: 'shop' });

    const { text } = await call('update_screen_design', {
      diagram: 'shop',
      operations: [
        { op: 'update_screen', screen: 'Products', purpose: 'Browse everything we sell' },
        {
          op: 'insert_html',
          screen: 'Products',
          html: '<input type="search" placeholder="Search products" data-binding="state.q">',
        },
        { op: 'remove_node', screen: 'Products', element: 'nothing called this' },
      ],
    });

    expect(text).toContain('Applied 2 of 3');
    expect(text).toContain('nothing called this');

    const design = await designs.read('shop');
    const products = design.screens.find((s) => s.name === 'Products')!;
    expect(products.purpose).toBe('Browse everything we sell');
    expect(products.html).toContain('Search products');
  });

  it('adds a variant artboard for the same screen', async () => {
    await seedDiagram();
    await call('sync_screen_designs', { diagram: 'shop' });
    await call('design_screen', {
      diagram: 'shop',
      screen: 'Products',
      variant: 'Empty',
      html: '<main class="screen"><p>Nothing here yet.</p></main>',
    });

    const stored = await designs.read('shop');
    const variants = stored.screens.filter((s) => s.name === 'Products');
    expect(variants).toHaveLength(2);
    expect(variants.some((s) => s.variant === 'Empty')).toBe(true);
    // Both artboards still point at the same block.
    expect(new Set(variants.map((s) => s.blockId)).size).toBe(1);
  });

  it('keeps designs when the diagram gains a screen, and flags ones whose block has gone', async () => {
    await seedDiagram();
    await call('sync_screen_designs', { diagram: 'shop' });
    await call('design_screen', {
      diagram: 'shop',
      screen: 'Login',
      html: '<main class="screen"><h1>Hand-written</h1></main>',
    });

    await call('add_blocks', {
      diagram: 'shop',
      blocks: [{ type: 'ui_screen', name: 'Basket', data: { route: '/basket' } }],
    });
    await call('delete_blocks', { diagram: 'shop', blocks: ['Products'] });

    const { text } = await call('sync_screen_designs', { diagram: 'shop' });
    expect(text).toContain('Basket');
    expect(text).toContain('Products');

    const stored = await designs.read('shop');
    // The hand-written screen survived untouched.
    const login = stored.screens.find((s) => s.name === 'Login')!;
    expect(login.html).toContain('Hand-written');
    // The deleted block's design is flagged, not destroyed.
    const products = stored.screens.find((s) => s.name === 'Products')!;
    expect(products.orphaned).toBe(true);
  });

  it('folds the designs into the implementation spec', async () => {
    await seedDiagram();
    await call('sync_screen_designs', { diagram: 'shop' });
    await call('design_screen', {
      diagram: 'shop',
      screen: 'Login',
      html:
        '<main class="screen"><h1>Welcome back</h1>' +
        '<button class="btn primary" data-action="POST /api/session">Sign in</button></main>',
    });

    const { text } = await call('read_implementation_spec', { diagram: 'shop' });
    expect(text).toContain('## Design system');
    expect(text).toContain('Welcome back');
    expect(text).toContain('does → POST /api/session');

    const without = await call('read_implementation_spec', { diagram: 'shop', includeDesign: false });
    expect(without.text).not.toContain('Welcome back');
  });

  it('nudges towards designing when the spec is read with nothing drawn', async () => {
    await seedDiagram();
    const { text } = await call('read_implementation_spec', { diagram: 'shop' });
    expect(text).toContain('No screens have been designed yet');
  });

  it('reports the holes: buttons that do nothing and fields with no binding', async () => {
    await seedDiagram();
    await call('sync_screen_designs', { diagram: 'shop' });
    await call('design_screen', {
      diagram: 'shop',
      screen: 'Products',
      html:
        '<main class="screen"><button>Do something</button>' +
        '<label>Quantity<input data-el="els_qty"></label></main>',
    });

    const { text } = await call('design_progress', { diagram: 'shop' });
    expect(text).toContain('Do something');
    expect(text).toContain('input');
  });

  it('tells the caller what it stripped on the way in', async () => {
    await seedDiagram();
    await call('sync_screen_designs', { diagram: 'shop' });

    const { text } = await call('design_screen', {
      diagram: 'shop',
      screen: 'Products',
      html:
        '<main class="screen"><script>steal()</script>' +
        '<h1 onclick="steal()">Products</h1>' +
        '<img src="https://example.com/shop.jpg" alt="The shop"></main>',
    });

    expect(text).toContain('Corrected on the way in');
    expect(text).toContain('<script>');
    expect(text).toContain('onclick');

    const design = await designs.read('shop');
    const products = design.screens.find((s) => s.name === 'Products')!;
    expect(products.html).not.toContain('script');
    expect(products.html).not.toContain('onclick');
    // The words and the intent survive; only the ways of doing something go.
    expect(products.html).toContain('Products');
    expect(products.html).toContain('data-src="https://example.com/shop.jpg"');
  });

  it('never leaves two artboards on top of each other after a device change', async () => {
    await seedDiagram();
    await call('sync_screen_designs', { diagram: 'shop' });

    const { text } = await call('design_screen', {
      diagram: 'shop',
      screen: 'Login',
      device: 'wide',
      html: '<main class="screen"><h1>Sign in</h1></main>',
    });
    expect(text).toContain('moved clear');

    const design = await designs.read('shop');
    for (const a of design.screens) {
      for (const b of design.screens) {
        if (a.id === b.id) continue;
        const apart =
          a.position.x + a.frame.width <= b.position.x ||
          b.position.x + b.frame.width <= a.position.x ||
          a.position.y + a.frame.height <= b.position.y ||
          b.position.y + b.frame.height <= a.position.y;
        expect(apart, `${a.name} overlaps ${b.name}`).toBe(true);
      }
    }
  });

  it('tells the implementer to build the approved screens exactly', async () => {
    await seedDiagram();
    await call('sync_screen_designs', { diagram: 'shop' });
    await call('update_screen_design', {
      diagram: 'shop',
      operations: [{ op: 'update_screen', screen: 'Login', status: 'approved' }],
    });

    const { text } = await call('read_implementation_spec', { diagram: 'shop' });
    expect(text).toContain('the same elements, the same nesting and order');
    expect(text).toContain('**Approved.** Build this exactly');
    // And the one nobody has approved is named, rather than passed off as
    // designed alongside it.
    expect(text).toContain('Not approved yet');
    expect(text).toContain('Products');
  });

  it('carries the designs across a rename, and deletes them with the diagram', async () => {
    await seedDiagram();
    await call('sync_screen_designs', { diagram: 'shop' });

    await store.rename('shop', 'Corner Shop');
    expect(await designs.exists('shop')).toBe(false);
    const moved = await designs.read('corner-shop');
    expect(moved.slug).toBe('corner-shop');
    expect(moved.screens.length).toBe(2);

    await store.delete('corner-shop');
    expect(await designs.exists('corner-shop')).toBe(false);
  });
});
