import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DiagramStore } from '@diagram-plus/core';
import { createMcpServer } from '@diagram-plus/mcp';

/**
 * `read_project_tree` is the tool to reach for when the diagram has to be
 * explained rather than built, so what is under test here is mostly what it
 * refuses to say: no endpoints, no services, no tables.
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
  root = await mkdtemp(path.join(os.tmpdir(), 'diagram-plus-tree-'));
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
      { type: 'data_model', name: 'Order', data: { fields: [{ name: 'id' }] } },
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
      { source: 'Create order', target: 'Order', type: 'writes' },
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

describe('read_project_tree', () => {
  it('is offered alongside the rest of the reading tools', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('read_project_tree');
  });

  it('gives a client the flow without the plumbing', async () => {
    const { text, isError } = await call('read_project_tree', { diagram: 'corner-shop' });
    expect(isError).toBe(false);
    expect(text).toContain('Browse');
    expect(text).toContain('Checkout');
    expect(text).toContain('If the card was declined');
    expect(text).not.toContain('POST');
    expect(text).not.toContain('/orders');
  });

  it('keeps every block when asked for the technical view', async () => {
    const { text } = await call('read_project_tree', {
      diagram: 'corner-shop',
      audience: 'technical',
    });
    expect(text).toContain('Create order');
    expect(text).toContain('Order');
  });

  it('honours the filters and says what they removed', async () => {
    const { text } = await call('read_project_tree', {
      diagram: 'corner-shop',
      types: ['ui_screen'],
    });
    // The decision is gone from the tree — it survives only in the footnote
    // that says what was removed, which is the point of keeping that footnote.
    expect(text).not.toContain('If the card was declined');
    expect(text).toContain('left out by the filter: Card accepted');
    // The flow behind the filtered decision still arrives.
    expect(text).toContain('Confirmation');
  });

  it('writes Markdown when that is what is wanted', async () => {
    const { text } = await call('read_project_tree', {
      diagram: 'corner-shop',
      format: 'markdown',
    });
    expect(text).toContain('# Corner Shop');
    expect(text).toContain('## Browse');
  });

  it('drops the branches when conditions are turned off', async () => {
    const { text } = await call('read_project_tree', {
      diagram: 'corner-shop',
      showConditions: false,
    });
    expect(text).not.toContain('If the card');
  });

  it('reaches the same renderer through export_diagram', async () => {
    const { text } = await call('export_diagram', { diagram: 'corner-shop', format: 'tree' });
    expect(text).toContain('Browse');
    expect(text).not.toContain('flowchart');
  });

  it('reports a diagram that is not there rather than inventing one', async () => {
    const { isError } = await call('read_project_tree', { diagram: 'no-such-thing' });
    expect(isError).toBe(true);
  });
});
