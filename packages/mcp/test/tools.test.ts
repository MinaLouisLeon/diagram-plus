import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DiagramStore } from '@diagram-plus/core';
import { createMcpServer } from '@diagram-plus/mcp';

/**
 * The MCP tools are driven through a real client, so the wire schemas, the
 * argument validation and the text a model actually sees are all under test.
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
  root = await mkdtemp(path.join(os.tmpdir(), 'diagram-plus-mcp-'));
  store = new DiagramStore({ root });
  const server = createMcpServer({ store, editorUrl: 'http://localhost:4517' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

afterEach(async () => {
  await client.close();
  await rm(root, { recursive: true, force: true });
});

describe('tool surface', () => {
  it('exposes the tools the design and build flows need', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const expected of [
      'describe_block_schema',
      'create_diagram_from_outline',
      'get_diagram',
      'read_implementation_spec',
      'add_blocks',
      'update_block',
      'add_edges',
      'apply_batch',
      'validate_diagram',
      'set_diagram_status',
      'mark_block_implemented',
      'implementation_progress',
    ]) {
      expect(names, `tool ${expected}`).toContain(expected);
    }
  });

  it('offers a prompt for each half of the loop', async () => {
    const names = (await client.listPrompts()).prompts.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['design_project', 'implement_from_diagram']));
  });

  it('describes the payload of every block type', async () => {
    const { text } = await call('describe_block_schema');
    const payload = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as {
      blockTypes: { type: string; dataFields: unknown[] }[];
      edgeTypes: unknown[];
    };
    expect(payload.blockTypes).toHaveLength(15);
    expect(payload.edgeTypes).toHaveLength(11);
    const endpoint = payload.blockTypes.find((b) => b.type === 'api_endpoint');
    expect(endpoint?.dataFields.length).toBeGreaterThan(5);
  });

  it('spells out the block types in the tool description itself', async () => {
    const tool = (await client.listTools()).tools.find((t) => t.name === 'create_diagram_from_outline');
    expect(tool?.description).toContain('data_model');
    expect(tool?.description).toContain('steps: string[]');
  });
});

describe('building a diagram', () => {
  it('creates a whole diagram, wired up and laid out, in one call', async () => {
    const { text, isError } = await call('create_diagram_from_outline', {
      name: 'Bug Tracker',
      projectGoal: 'Let a small team file and triage bugs.',
      techStack: { language: 'TypeScript', database: 'SQLite' },
      blocks: [
        { type: 'data_model', name: 'Bug', data: { fields: [{ name: 'id', type: 'uuid', required: true }] } },
        { type: 'service', name: 'BugService', data: { functions: [{ name: 'triage', steps: ['pick an owner'] }] } },
        { type: 'ui_screen', name: 'Inbox', data: { route: '/inbox' } },
      ],
      edges: [
        { source: 'Inbox', target: 'BugService', type: 'calls' },
        { source: 'BugService', target: 'Bug', type: 'writes' },
      ],
    });
    expect(isError).toBe(false);
    expect(text).toContain('3 blocks and 2 connections');
    expect(text).toContain('http://localhost:4517/d/bug-tracker');

    const diagram = await store.read('bug-tracker');
    expect(diagram.blocks).toHaveLength(3);
    expect(diagram.edges).toHaveLength(2);
    // Auto-layout ran, so nothing is left stacked at the origin.
    expect(new Set(diagram.blocks.map((b) => b.position.x)).size).toBeGreaterThan(1);
  });

  it('says which block a bad reference meant to hit', async () => {
    await call('create_diagram', { name: 'Refs' });
    const { text, isError } = await call('update_block', {
      diagram: 'refs',
      block: 'Nowhere',
      patch: { name: 'x' },
    });
    expect(isError).toBe(true);
    expect(text).toContain('No block matching "Nowhere"');
  });

  it('refuses a block type that does not exist', async () => {
    await call('create_diagram', { name: 'Types' });
    const { text, isError } = await call('add_blocks', {
      diagram: 'types',
      blocks: [{ type: 'spaceship', name: 'X' }],
    });
    expect(isError).toBe(true);
    expect(text).toMatch(/spaceship|enum/i);
    // ...and the diagram is untouched.
    expect((await store.read('types')).blocks).toHaveLength(0);
  });

  it('merges a payload change without dropping the rest', async () => {
    await call('create_diagram_from_outline', {
      name: 'Merge',
      blocks: [{ type: 'data_model', name: 'Row', data: { fields: [{ name: 'id' }] } }],
    });
    await call('update_block', {
      diagram: 'merge',
      block: 'Row',
      patch: { data: { tableName: 'rows' } },
    });
    const block = (await store.read('merge')).blocks[0];
    expect(block?.type).toBe('data_model');
    if (block?.type === 'data_model') {
      expect(block.data.tableName).toBe('rows');
      expect(block.data.fields).toHaveLength(1);
    }
  });

  it('applies a batch and reports the operations that failed', async () => {
    await call('create_diagram', { name: 'Batch' });
    const { text } = await call('apply_batch', {
      diagram: 'batch',
      operations: [
        { op: 'add_block', block: { type: 'note', name: 'Kept' } },
        { op: 'add_edge', edge: { source: 'Kept', target: 'Missing' } },
      ],
    });
    expect(text).toContain('Applied 1 of 2');
    expect(text).toContain('Missing');
  });
});

describe('the whole loop', () => {
  it('designs, reviews, freezes, reads a spec and records the build', async () => {
    // 1. Claude designs the project.
    await call('create_diagram_from_outline', {
      name: 'Link Saver',
      projectGoal: 'Save links and tag them.',
      techStack: { language: 'TypeScript', backend: 'Express', database: 'PostgreSQL' },
      blocks: [
        { type: 'config', name: 'Environment', data: { keys: [{ name: 'DATABASE_URL', required: true }] } },
        {
          type: 'data_model',
          name: 'Link',
          data: {
            tableName: 'links',
            fields: [
              { name: 'id', type: 'uuid', required: true },
              { name: 'url', type: 'string', required: true },
            ],
          },
        },
        {
          type: 'api_endpoint',
          name: 'Save link',
          data: {
            method: 'POST',
            path: '/api/links',
            auth: 'user',
            requestBody: [{ name: 'url', type: 'string', required: true }],
            responses: [{ status: 201, description: 'Saved' }],
          },
        },
        { type: 'ui_screen', name: 'Saved links', data: { route: '/links', purpose: 'Browse saved links' } },
      ],
      edges: [
        { source: 'Saved links', target: 'Save link', type: 'calls' },
        { source: 'Save link', target: 'Link', type: 'writes' },
      ],
    });

    // 2. The user edits it in the app — same store, same file.
    await store.update('link-saver', (draft) => {
      const link = draft.blocks.find((b) => b.name === 'Link');
      if (link?.type === 'data_model') {
        link.data.fields.push({ name: 'tags', type: 'string[]', required: false, description: '', example: '' });
      }
    });

    // 3. Claude sees the user's edit.
    const seen = await call('get_block', { diagram: 'link-saver', block: 'Link' });
    expect(seen.text).toContain('tags');

    // 4. The user marks it ready.
    await call('set_diagram_status', { diagram: 'link-saver', status: 'ready' });
    const validation = await call('validate_diagram', { diagram: 'link-saver' });
    expect(validation.text).toContain('0 error(s)');

    // 5. Claude reads the spec and builds from it.
    const spec = await call('read_implementation_spec', { diagram: 'link-saver' });
    expect(spec.text).not.toContain('still a draft');
    expect(spec.text).toContain('Save links and tag them.');
    expect(spec.text).toContain('POST /api/links');
    expect(spec.text).toContain('`tags`');
    expect(spec.text.indexOf('Configuration')).toBeLessThan(spec.text.indexOf('Screens'));

    // 6. Claude records what it built.
    await call('mark_block_implemented', {
      diagram: 'link-saver',
      block: 'Link',
      files: ['src/db/link.ts'],
    });
    const progress = await call('implementation_progress', { diagram: 'link-saver' });
    expect(progress.text).toContain('25% built');
    expect(progress.text).toContain('Save link');

    const finalState = await store.read('link-saver');
    expect(finalState.blocks.find((b) => b.name === 'Link')?.implementation.files).toEqual([
      'src/db/link.ts',
    ]);
  });

  it('warns before implementing a diagram the user has not approved', async () => {
    await call('create_diagram_from_outline', {
      name: 'Unfinished',
      blocks: [{ type: 'data_model', name: 'Thing', data: { fields: [{ name: 'id' }] } }],
    });
    const spec = await call('read_implementation_spec', { diagram: 'unfinished' });
    expect(spec.text).toContain('still a draft');
  });
});

describe('reading', () => {
  beforeEach(async () => {
    await call('create_diagram_from_outline', {
      name: 'Reader',
      blocks: [
        { type: 'data_model', name: 'Account', data: { fields: [{ name: 'id' }] } },
        { type: 'service', name: 'Billing', summary: 'Charges cards', data: { functions: [{ name: 'charge' }] } },
      ],
      edges: [{ source: 'Billing', target: 'Account', type: 'reads' }],
    });
  });

  it('lists the diagrams in the project', async () => {
    const { text } = await call('list_diagrams');
    expect(text).toContain('**Reader**');
    expect(text).toContain('2 blocks');
  });

  it('gives an outline by default and the full JSON on request', async () => {
    const outline = await call('get_diagram', { diagram: 'reader' });
    expect(outline.text).toContain('## Blocks (2)');
    expect(outline.text).not.toContain('"formatVersion"');

    const full = await call('get_diagram', { diagram: 'reader', detail: 'full' });
    expect(full.text).toContain('"formatVersion"');
  });

  it('searches blocks by text and by type', async () => {
    expect((await call('search_blocks', { diagram: 'reader', query: 'charges' })).text).toContain('Billing');
    expect((await call('search_blocks', { diagram: 'reader', type: 'data_model' })).text).toContain('Account');
    expect((await call('search_blocks', { diagram: 'reader', query: 'zzz' })).text).toContain('No blocks matched');
  });

  it('exports Mermaid', async () => {
    const { text } = await call('export_diagram', { diagram: 'reader', format: 'mermaid' });
    expect(text).toContain('flowchart LR');
  });

  it('points the user at the editor', async () => {
    const { text } = await call('open_editor', { diagram: 'reader' });
    expect(text).toContain('http://localhost:4517/d/reader');
  });
});
