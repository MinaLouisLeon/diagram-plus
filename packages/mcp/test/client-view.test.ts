import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DiagramStore } from '@diagram-plus/core';
import { createMcpServer } from '@diagram-plus/mcp';

/**
 * The client view round trip, driven the way Claude drives it: read what the
 * client changed, carry it into the technical diagram, and push a technical
 * change back the other way.
 */

let store: DiagramStore;
let client: Client;
let root: string;

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  return { text: result.content.map((c) => c.text).join('\n'), isError: result.isError === true };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'diagram-plus-client-'));
  store = new DiagramStore({ root });
  const server = createMcpServer({ store, editorUrl: 'http://localhost:4517' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  await call('create_diagram_from_outline', {
    name: 'Corner Shop',
    projectGoal: 'Sell things online.',
    blocks: [
      { type: 'ui_screen', name: 'Browse', data: { purpose: 'See what is for sale' } },
      { type: 'ui_screen', name: 'Checkout', data: { purpose: 'Pay for the basket' } },
      { type: 'ui_screen', name: 'Confirmation', data: { purpose: 'Thank you' } },
      {
        type: 'api_endpoint',
        name: 'Create order',
        data: { method: 'POST', path: '/orders', summary: 'Takes the basket and charges for it' },
      },
      {
        type: 'decision',
        name: 'Card accepted',
        data: {
          condition: 'Did the payment go through?',
          branches: [
            { label: 'accepted', when: 'the card was accepted' },
            { label: 'declined', when: 'the card was declined' },
          ],
        },
      },
    ],
    edges: [
      { source: 'Browse', target: 'Checkout', type: 'navigation' },
      { source: 'Checkout', target: 'Create order', type: 'calls' },
      { source: 'Create order', target: 'Card accepted', type: 'calls' },
      { source: 'Card accepted', target: 'Confirmation', type: 'conditional', condition: 'accepted' },
      { source: 'Card accepted', target: 'Checkout', type: 'conditional', condition: 'declined' },
    ],
  });
});

afterEach(async () => {
  await client.close();
  await rm(root, { recursive: true, force: true });
});

describe('the client view tools', () => {
  it('are all offered', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'read_client_view',
        'update_client_view',
        'sync_client_view',
        'apply_client_view',
      ]),
    );
  });

  it('reads the flow in plain words, with no plumbing in it', async () => {
    const { text, isError } = await call('read_client_view', { diagram: 'corner-shop' });
    expect(isError).toBe(false);
    expect(text).toContain('Browse (screen)');
    expect(text).toContain('Card accepted (decision)');
    expect(text).not.toContain('POST');
    expect(text).not.toContain('/orders');
    expect(text).toContain('The client view and the technical diagram agree.');
  });

  it('records what the client asked for without touching the diagram', async () => {
    const { text } = await call('update_client_view', {
      diagram: 'corner-shop',
      operations: [
        {
          op: 'add_node',
          name: 'Text the customer',
          type: 'job',
          description: 'Let them know it shipped',
          after: 'Confirmation',
        },
        { op: 'update_node', node: 'Checkout', name: 'Payment page' },
        { op: 'set_notes', notes: 'They want SMS receipts.' },
      ],
    });
    expect(text).toContain('Applied 3 of 3');
    expect(text).toContain('new automatic "Text the customer"');
    expect(text).toContain('reworded "Checkout" → "Payment page"');

    // The technical diagram has not moved.
    const diagram = await store.read('corner-shop');
    expect(diagram.blocks.map((b) => b.name)).toContain('Checkout');
    expect(diagram.blocks.map((b) => b.name)).not.toContain('Text the customer');
  });

  it('shows the plan before doing anything, when asked', async () => {
    await call('update_client_view', {
      diagram: 'corner-shop',
      operations: [{ op: 'add_node', name: 'Text the customer', type: 'job' }],
    });
    const { text } = await call('apply_client_view', { diagram: 'corner-shop', dryRun: true });
    expect(text).toContain('add_block');
    expect(text).toContain('Nothing has been changed.');
    const diagram = await store.read('corner-shop');
    expect(diagram.blocks.map((b) => b.name)).not.toContain('Text the customer');
  });

  it('carries the client\'s changes into the technical diagram', async () => {
    await call('update_client_view', {
      diagram: 'corner-shop',
      operations: [
        { op: 'add_node', name: 'Text the customer', type: 'job' },
        { op: 'update_node', node: 'Checkout', name: 'Payment page' },
        { op: 'add_edge', source: 'Confirmation', target: 'Text the customer', type: 'calls' },
      ],
    });
    const { text } = await call('apply_client_view', { diagram: 'corner-shop' });
    expect(text).toContain('Text the customer');

    const diagram = await store.read('corner-shop');
    const job = diagram.blocks.find((b) => b.name === 'Text the customer');
    expect(job?.type).toBe('job');
    expect(job?.tags).toContain('from-client');
    expect(diagram.blocks.map((b) => b.name)).toContain('Payment page');
    const confirmation = diagram.blocks.find((b) => b.name === 'Confirmation')!;
    expect(
      diagram.edges.some((e) => e.source === confirmation.id && e.target === job!.id),
    ).toBe(true);

    // And the two documents now agree.
    const after = await call('read_client_view', { diagram: 'corner-shop' });
    expect(after.text).toContain('The client view and the technical diagram agree.');
  });

  it('keeps a deletion out of the diagram unless it is asked for', async () => {
    await call('update_client_view', {
      diagram: 'corner-shop',
      operations: [{ op: 'remove_node', node: 'Confirmation' }],
    });

    await call('apply_client_view', { diagram: 'corner-shop' });
    expect((await store.read('corner-shop')).blocks.map((b) => b.name)).toContain('Confirmation');

    await call('apply_client_view', { diagram: 'corner-shop', includeRemovals: true });
    expect((await store.read('corner-shop')).blocks.map((b) => b.name)).not.toContain('Confirmation');
  });

  it('pushes a change made to the diagram back into the client view', async () => {
    // A view the client has already been shown once.
    await call('sync_client_view', { diagram: 'corner-shop' });

    await call('add_blocks', {
      diagram: 'corner-shop',
      blocks: [{ type: 'ui_screen', name: 'Order history', data: { purpose: 'Past orders' } }],
    });

    const { text } = await call('sync_client_view', { diagram: 'corner-shop' });
    expect(text).toContain('new from the diagram: Order history');

    const view = (await store.read('corner-shop')).clientView;
    expect(view?.nodes.map((n) => n.name)).toContain('Order history');
  });

  it('does not undo the client\'s wording when it syncs', async () => {
    await call('update_client_view', {
      diagram: 'corner-shop',
      operations: [{ op: 'update_node', node: 'Checkout', name: 'Payment page' }],
    });
    await call('add_blocks', {
      diagram: 'corner-shop',
      blocks: [{ type: 'ui_screen', name: 'Order history' }],
    });
    await call('sync_client_view', { diagram: 'corner-shop' });

    const view = (await store.read('corner-shop')).clientView;
    expect(view?.nodes.map((n) => n.name)).toContain('Payment page');
    expect(view?.nodes.map((n) => n.name)).toContain('Order history');
  });

  it('reports an edit it cannot make rather than guessing', async () => {
    const { text } = await call('update_client_view', {
      diagram: 'corner-shop',
      operations: [{ op: 'update_node', node: 'Nothing called this', name: 'x' }],
    });
    expect(text).toContain('Applied 0 of 1');
    expect(text).toContain('No box matching');
  });

  it('reports a diagram that is not there rather than inventing one', async () => {
    const { isError } = await call('read_client_view', { diagram: 'no-such-thing' });
    expect(isError).toBe(true);
  });
});
