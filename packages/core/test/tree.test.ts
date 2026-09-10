import { describe, expect, it } from 'vitest';
import {
  addBlocks,
  addEdges,
  buildProjectTree,
  createDiagram,
  exportDiagram,
  treeToMarkdown,
  treeToMermaid,
  treeToText,
  walkTree,
  type Diagram,
  type TreeNode,
} from '@diagram-plus/core';

/**
 * A small shop with the shape that matters: a screen whose work goes through an
 * endpoint and a service before it reaches anything a client would recognise, a
 * decision with two named branches, an error path, and a loop back to the top.
 */
function shop(): Diagram {
  const diagram = createDiagram({ name: 'Corner Shop', description: 'Buy things online.' });
  addBlocks(diagram, [
    { type: 'ui_screen', name: 'Browse', position: { x: 0, y: 0 }, data: { purpose: 'See what is for sale' } },
    { type: 'ui_screen', name: 'Product', position: { x: 0, y: 100 }, data: { purpose: 'One item in detail' } },
    {
      type: 'ui_screen',
      name: 'Checkout',
      position: { x: 0, y: 200 },
      data: {
        purpose: 'Pay for the basket',
        actions: [{ name: 'Place the order', calls: 'Create order' }],
      },
    },
    { type: 'ui_screen', name: 'Confirmation', position: { x: 0, y: 300 }, data: { purpose: 'Thank you' } },
    { type: 'ui_component', name: 'Basket summary', position: { x: 0, y: 400 } },
    {
      type: 'api_endpoint',
      name: 'Create order',
      position: { x: 0, y: 500 },
      data: { method: 'POST', path: '/orders', summary: 'Takes the basket and charges for it' },
    },
    { type: 'service', name: 'OrderService', position: { x: 0, y: 600 } },
    { type: 'data_model', name: 'Order', position: { x: 0, y: 700 }, data: { fields: [{ name: 'id' }] } },
    {
      type: 'decision',
      name: 'Card accepted',
      position: { x: 0, y: 800 },
      data: {
        condition: 'Did the payment go through?',
        branches: [
          { label: 'accepted', when: 'the card was accepted', description: '' },
          { label: 'declined', when: 'the card was declined', description: 'The customer tries again.' },
        ],
      },
    },
    {
      type: 'external_service',
      name: 'Stripe',
      position: { x: 0, y: 900 },
      data: { provider: 'Stripe' },
    },
    {
      type: 'job',
      name: 'Nightly receipts',
      position: { x: 0, y: 1000 },
      data: { trigger: 'cron', schedule: 'every night at 2am' },
    },
    { type: 'note', name: 'Ask about VAT', position: { x: 0, y: 1100 } },
  ]);

  addEdges(diagram, [
    { source: 'Browse', target: 'Product', type: 'navigation' },
    { source: 'Product', target: 'Checkout', type: 'navigation' },
    { source: 'Checkout', target: 'Basket summary', type: 'renders' },
    { source: 'Checkout', target: 'Create order', type: 'calls' },
    { source: 'Create order', target: 'OrderService', type: 'calls' },
    { source: 'OrderService', target: 'Order', type: 'writes' },
    { source: 'OrderService', target: 'Stripe', type: 'calls' },
    { source: 'OrderService', target: 'Card accepted', type: 'calls' },
    { source: 'Card accepted', target: 'Confirmation', type: 'conditional', condition: 'accepted' },
    { source: 'Card accepted', target: 'Checkout', type: 'conditional', condition: 'declined' },
    { source: 'Checkout', target: 'Browse', type: 'error_flow', condition: 'the basket has expired' },
  ]);
  return diagram;
}

function flatten(tree: ReturnType<typeof buildProjectTree>): TreeNode[] {
  const out: TreeNode[] = [];
  walkTree(tree, (node) => out.push(node));
  return out;
}

const labels = (tree: ReturnType<typeof buildProjectTree>): string[] =>
  flatten(tree).map((n) => n.label);

describe('buildProjectTree', () => {
  it('starts at the screen nothing navigates to, then the automations', () => {
    const tree = buildProjectTree(shop());
    // The nightly job is an entry point too, but a person comes first.
    expect(tree.roots.map((r) => r.label)).toEqual(['Browse', 'Nightly receipts']);
  });

  it('folds the plumbing away but keeps the step it stood for', () => {
    const tree = buildProjectTree(shop());
    const names = labels(tree);
    // The endpoint and the service are gone as blocks…
    expect(names).not.toContain('OrderService');
    expect(names).not.toContain('Order');
    // …but the action the screen declared for them survives, and so does the
    // external service the chain eventually reached.
    expect(names).toContain('Place the order');
    expect(names).toContain('Stripe');
  });

  it('keeps everything when the reader is technical', () => {
    const names = labels(buildProjectTree(shop(), { audience: 'technical' }));
    expect(names).toContain('OrderService');
    expect(names).toContain('Create order');
    expect(names).toContain('Ask about VAT');
  });

  it('turns a decision into named branches carrying their conditions', () => {
    const tree = buildProjectTree(shop());
    const question = flatten(tree).find((n) => n.kind === 'question');
    expect(question?.label).toBe('Card accepted');
    expect(question?.children.map((c) => c.condition)).toEqual([
      'the card was accepted',
      'the card was declined',
    ]);
    expect(question?.children[0]!.label).toBe('Confirmation');
  });

  it('labels an error path', () => {
    const tree = buildProjectTree(shop());
    const error = flatten(tree).find((n) => n.condition === 'the basket has expired');
    expect(error).toBeDefined();
    expect(error!.label).toBe('Browse');
  });

  it('drops conditions when they are turned off', () => {
    const tree = buildProjectTree(shop(), { showConditions: false });
    expect(flatten(tree).every((n) => n.condition === '')).toBe(true);
    expect(labels(tree)).not.toContain('Card accepted');
  });

  it('shows data models only when asked', () => {
    expect(labels(buildProjectTree(shop()))).not.toContain('Order');
    expect(labels(buildProjectTree(shop(), { showData: true }))).toContain('Order');
  });

  it('marks a second sighting instead of looping forever', () => {
    const tree = buildProjectTree(shop());
    const repeats = flatten(tree).filter((n) => n.kind === 'repeat');
    expect(repeats.length).toBeGreaterThan(0);
    // Checkout is reached again from the declined branch.
    expect(repeats.map((n) => n.label)).toContain('Checkout');
    // Every block still appears exactly once as a real node.
    const real = flatten(tree).filter((n) => n.kind !== 'repeat' && n.blockId);
    expect(new Set(real.map((n) => n.blockId)).size).toBe(real.length);
  });

  it('reaches every visible block, even one stranded off the main flow', () => {
    const tree = buildProjectTree(shop());
    expect(labels(tree)).toContain('Nightly receipts');
  });

  it('filters by type and counts what it left out', () => {
    const tree = buildProjectTree(shop(), { filter: { types: ['ui_screen'] } });
    const names = labels(tree);
    expect(names).not.toContain('Card accepted');
    expect(names).not.toContain('Stripe');
    expect(tree.omitted.map((o) => o.name)).toContain('Stripe');
    // Filtering the decision out does not sever the flow behind it.
    expect(names).toContain('Confirmation');
  });

  it('filters by tag and by search', () => {
    const diagram = shop();
    diagram.blocks.find((b) => b.name === 'Browse')!.tags = ['phase-1'];
    expect(labels(buildProjectTree(diagram, { filter: { tags: ['phase-1'] } }))).toEqual(['Browse']);
    expect(labels(buildProjectTree(diagram, { filter: { search: 'confirm' } }))).toEqual([
      'Confirmation',
    ]);
  });

  it('stops at the depth limit and says so', () => {
    const tree = buildProjectTree(shop(), { maxDepth: 2 });
    expect(tree.truncated).toBe(true);
    let deepest = 0;
    walkTree(tree, (_node, depth) => {
      deepest = Math.max(deepest, depth);
    });
    expect(deepest).toBe(2);
  });

  it('buckets by group when there are groups', () => {
    const diagram = shop();
    diagram.groups.push({
      id: 'g1',
      name: 'Customer area',
      description: '',
      color: '',
      position: { x: 0, y: 0 },
      size: { width: 600, height: 400 },
      collapsed: false,
    });
    diagram.blocks.find((b) => b.name === 'Browse')!.groupId = 'g1';
    const tree = buildProjectTree(diagram);
    expect(tree.roots[0]!.kind).toBe('section');
    expect(tree.roots[0]!.label).toBe('Customer area');
    expect(tree.roots.at(-1)!.label).toBe('Everything else');
  });

  it('copes with a diagram where everything points at something', () => {
    const diagram = createDiagram({ name: 'Ring' });
    addBlocks(diagram, [
      { type: 'ui_screen', name: 'A' },
      { type: 'ui_screen', name: 'B' },
    ]);
    addEdges(diagram, [
      { source: 'A', target: 'B', type: 'navigation' },
      { source: 'B', target: 'A', type: 'navigation' },
    ]);
    const tree = buildProjectTree(diagram);
    expect(tree.roots).toHaveLength(1);
    expect(tree.nodeCount).toBe(3); // A, B, and the pointer back to A
  });

  it('handles an empty diagram', () => {
    const tree = buildProjectTree(createDiagram({ name: 'Nothing yet' }));
    expect(tree.roots).toEqual([]);
    expect(treeToText(tree)).toContain('nothing to show');
  });
});

describe('rendering a tree', () => {
  it('draws plain text a client can read', () => {
    const text = treeToText(buildProjectTree(shop()));
    expect(text).toContain('Corner Shop');
    expect(text).toContain('├─ ');
    expect(text).toContain('If the card was declined → Checkout');
    expect(text).not.toContain('OrderService');
  });

  it('writes Markdown with the roots as headings', () => {
    const markdown = treeToMarkdown(buildProjectTree(shop()));
    expect(markdown).toContain('# Corner Shop');
    expect(markdown).toContain('## Browse');
    expect(markdown).toContain('- **Place the order**');
  });

  it('writes a Mermaid flowchart smaller than the full diagram', () => {
    const diagram = shop();
    const mermaid = treeToMermaid(buildProjectTree(diagram));
    expect(mermaid.startsWith('flowchart TD')).toBe(true);
    expect(mermaid).toContain('"the card was declined"');
    expect(mermaid.length).toBeLessThan(exportDiagram(diagram, 'mermaid').length);
  });

  it('is reachable through exportDiagram', () => {
    const diagram = shop();
    expect(exportDiagram(diagram, 'tree')).toBe(treeToText(buildProjectTree(diagram)));
    expect(exportDiagram(diagram, 'tree-markdown')).toBe(
      treeToMarkdown(buildProjectTree(diagram)),
    );
  });

  it('mentions filtered-out blocks in the footer rather than hiding them', () => {
    const text = treeToText(buildProjectTree(shop(), { filter: { types: ['ui_screen'] } }));
    expect(text).toContain('left out by the filter');
  });
});
