import { describe, expect, it } from 'vitest';
import {
  addBlocks,
  addEdges,
  applyClientView,
  clientViewOperations,
  createDiagram,
  deriveClientView,
  diffClientView,
  editClientView,
  ensureClientView,
  layoutClientView,
  reconcileClientView,
  renderClientView,
  type ClientNode,
  type ClientView,
  type Diagram,
} from '@diagram-plus/core';

/**
 * The client view is the document a client edits, so what is under test is
 * mostly what survives: their wording, their new boxes, and their deletions —
 * across a re-derive, and back into the technical diagram afterwards.
 */

function shop(): Diagram {
  const diagram = createDiagram({ name: 'Corner Shop', description: 'Buy things online.' });
  addBlocks(diagram, [
    { type: 'ui_screen', name: 'Browse', position: { x: 0, y: 0 }, data: { purpose: 'See what is for sale' } },
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
          { label: 'declined', when: 'the card was declined', description: '' },
        ],
      },
    },
  ]);

  addEdges(diagram, [
    { source: 'Browse', target: 'Checkout', type: 'navigation' },
    { source: 'Checkout', target: 'Create order', type: 'calls' },
    { source: 'Create order', target: 'OrderService', type: 'calls' },
    { source: 'OrderService', target: 'Order', type: 'writes' },
    { source: 'OrderService', target: 'Card accepted', type: 'calls' },
    { source: 'Card accepted', target: 'Confirmation', type: 'conditional', condition: 'accepted' },
    { source: 'Card accepted', target: 'Checkout', type: 'conditional', condition: 'declined' },
  ]);
  return diagram;
}

const names = (view: ClientView): string[] =>
  [...view.nodes].sort((a, b) => a.order - b.order).map((n) => n.name);

const find = (view: ClientView, name: string): ClientNode => {
  const node = view.nodes.find((n) => n.name === name);
  if (!node) throw new Error(`No box called ${name}. Have: ${names(view).join(', ')}`);
  return node;
};

/** The client adds a box, the way the editor does. */
function addBox(view: ClientView, node: Partial<ClientNode> & { name: string }): ClientView {
  const added: ClientNode = {
    id: `cvn_${node.name.replace(/\W/g, '')}`,
    blockId: null,
    type: 'ui_screen',
    description: '',
    condition: '',
    branches: [],
    position: { x: 0, y: 0 },
    size: { width: 260, height: 96 },
    pinned: false,
    order: view.nodes.length,
    origin: 'client',
    edited: false,
    orphaned: false,
    via: [],
    note: '',
    ...node,
  };
  return { ...view, nodes: [...view.nodes, added] };
}

describe('deriveClientView', () => {
  it('keeps what a client recognises and folds the rest away', () => {
    const view = deriveClientView(shop());
    expect(names(view)).toEqual(['Browse', 'Checkout', 'Card accepted', 'Confirmation']);
    // The endpoint, the service and the table are plumbing.
    expect(names(view)).not.toContain('Create order');
    expect(names(view)).not.toContain('OrderService');
    expect(names(view)).not.toContain('Order');
  });

  it('draws one arrow per path, through the plumbing, named after the step', () => {
    const view = deriveClientView(shop());
    const checkout = find(view, 'Checkout');
    const decision = find(view, 'Card accepted');
    const arrow = view.edges.find((e) => e.source === checkout.id && e.target === decision.id);
    expect(arrow, 'Checkout should reach the decision through the endpoint').toBeDefined();
    // The screen named the action; that name beats the endpoint's.
    expect(arrow?.label).toBe('Place the order');
    expect(arrow?.via).toContain('Create order');
    // It is not a single technical edge, so it does not claim to be one.
    expect(arrow?.edgeId).toBeNull();
  });

  it('carries the conditions onto the arrows', () => {
    const view = deriveClientView(shop());
    const conditions = view.edges.map((e) => e.condition).filter(Boolean);
    expect(conditions).toContain('accepted');
    expect(conditions).toContain('declined');
  });

  it('keeps the decision question and its branches on the box', () => {
    const box = find(deriveClientView(shop()), 'Card accepted');
    expect(box.condition).toBe('Did the payment go through?');
    expect(box.branches.map((b) => b.label)).toEqual(['accepted', 'declined']);
  });

  it('shows every block when the audience is technical', () => {
    const view = deriveClientView(shop(), { audience: 'technical' });
    expect(names(view)).toContain('OrderService');
    expect(names(view)).toContain('Order');
  });
});

describe('layoutClientView', () => {
  it('lays the flow out in steps, starting at the top', () => {
    const view = deriveClientView(shop());
    expect(find(view, 'Browse').position.y).toBe(0);
    expect(find(view, 'Checkout').position.y).toBeGreaterThan(0);
  });

  it('leaves a box that was dragged where it was put', () => {
    const view = deriveClientView(shop());
    const moved: ClientView = {
      ...view,
      nodes: view.nodes.map((n) =>
        n.name === 'Checkout' ? { ...n, position: { x: 999, y: 999 }, pinned: true } : n,
      ),
    };
    const after = layoutClientView(moved);
    expect(find(after, 'Checkout').position).toEqual({ x: 999, y: 999 });
    // Tidying up on purpose moves it anyway.
    expect(find(layoutClientView(moved, { includePinned: true }), 'Checkout').position).not.toEqual({
      x: 999,
      y: 999,
    });
  });
});

describe('reconcileClientView', () => {
  it('keeps the wording the client changed', () => {
    const diagram = shop();
    const view = deriveClientView(diagram);
    const edited: ClientView = {
      ...view,
      nodes: view.nodes.map((n) =>
        n.name === 'Checkout' ? { ...n, name: 'Payment page', edited: true } : n,
      ),
    };
    const { view: after } = reconcileClientView(diagram, edited);
    expect(names(after)).toContain('Payment page');
    expect(names(after)).not.toContain('Checkout');
  });

  it('keeps boxes the client added', () => {
    const diagram = shop();
    const view = addBox(deriveClientView(diagram), { name: 'Text the customer', type: 'job' });
    const { view: after } = reconcileClientView(diagram, view);
    expect(names(after)).toContain('Text the customer');
  });

  it('does not resurrect a box the client deleted', () => {
    const diagram = shop();
    const view = deriveClientView(diagram);
    const confirmation = find(view, 'Confirmation');
    const pruned: ClientView = {
      ...view,
      nodes: view.nodes.filter((n) => n.id !== confirmation.id),
      removed: [{ blockId: confirmation.blockId!, edgeId: '', name: 'Confirmation', at: '' }],
    };
    const { view: after } = reconcileClientView(diagram, pruned);
    expect(names(after)).not.toContain('Confirmation');
  });

  it('brings across a block added to the technical diagram', () => {
    const diagram = shop();
    const view = deriveClientView(diagram);
    addBlocks(diagram, [{ type: 'ui_screen', name: 'Order history', data: { purpose: 'Past orders' } }]);
    const { view: after, added } = reconcileClientView(diagram, view);
    expect(names(after)).toContain('Order history');
    expect(added).toContain('Order history');
  });

  it('flags a box whose block has been deleted rather than dropping it', () => {
    const diagram = shop();
    const view = deriveClientView(diagram);
    diagram.blocks = diagram.blocks.filter((b) => b.name !== 'Confirmation');
    const { view: after, orphaned } = reconcileClientView(diagram, view);
    expect(orphaned).toContain('Confirmation');
    expect(find(after, 'Confirmation').orphaned).toBe(true);
  });

  it('refreshes wording the client did not touch', () => {
    const diagram = shop();
    const view = deriveClientView(diagram);
    const browse = diagram.blocks.find((b) => b.name === 'Browse')!;
    browse.name = 'Shop front';
    const { view: after, updated } = reconcileClientView(diagram, view);
    expect(names(after)).toContain('Shop front');
    expect(updated).toContain('Shop front');
  });
});

describe('diffClientView', () => {
  it('says nothing changed when nothing has', () => {
    const diagram = shop();
    const diff = diffClientView(diagram, deriveClientView(diagram));
    expect(diff.hasChanges).toBe(false);
  });

  it('reports a new box, a rewording and a deletion', () => {
    const diagram = shop();
    let view = deriveClientView(diagram);
    const confirmation = find(view, 'Confirmation');
    view = {
      ...view,
      nodes: view.nodes
        .filter((n) => n.id !== confirmation.id)
        .map((n) => (n.name === 'Checkout' ? { ...n, name: 'Payment page', edited: true } : n)),
      removed: [{ blockId: confirmation.blockId!, edgeId: '', name: 'Confirmation', at: '' }],
    };
    view = addBox(view, { name: 'Text the customer', type: 'job' });

    const diff = diffClientView(diagram, view);
    expect(diff.addedNodes.map((n) => n.name)).toEqual(['Text the customer']);
    expect(diff.reworded.map((r) => `${r.from}→${r.to}`)).toEqual(['Checkout→Payment page']);
    expect(diff.removed.map((r) => r.name)).toEqual(['Confirmation']);
    expect(diff.hasChanges).toBe(true);
  });

  it('notices a block the view has never been shown', () => {
    const diagram = shop();
    const view = deriveClientView(diagram);
    addBlocks(diagram, [{ type: 'ui_screen', name: 'Order history' }]);
    expect(diffClientView(diagram, view).missing.map((m) => m.name)).toEqual(['Order history']);
  });

  it('reports a reordering without pretending to know what to do about it', () => {
    const diagram = shop();
    const view = deriveClientView(diagram);
    const reversed: ClientView = {
      ...view,
      nodes: view.nodes.map((n) => ({ ...n, order: view.nodes.length - n.order })),
    };
    const diff = diffClientView(diagram, reversed);
    expect(diff.reordered.length).toBeGreaterThan(0);
    // Reordering alone is not something to apply to the diagram.
    expect(diff.hasChanges).toBe(false);
  });
});

describe('applyClientView', () => {
  it('turns a box the client added into a real block, tagged as theirs', () => {
    const diagram = shop();
    diagram.clientView = addBox(deriveClientView(diagram), {
      name: 'Text the customer',
      type: 'job',
      description: 'Let them know it shipped',
    });

    const result = applyClientView(diagram);
    const block = diagram.blocks.find((b) => b.name === 'Text the customer');
    expect(block).toBeDefined();
    expect(block?.type).toBe('job');
    expect(block?.tags).toContain('from-client');
    expect(block?.summary).toBe('Let them know it shipped');
    // The box now stands for the block it created.
    expect(result.view.nodes.find((n) => n.name === 'Text the customer')?.blockId).toBe(block?.id);
  });

  it('applies a rewording to the block behind it', () => {
    const diagram = shop();
    const view = deriveClientView(diagram);
    diagram.clientView = {
      ...view,
      nodes: view.nodes.map((n) =>
        n.name === 'Checkout' ? { ...n, name: 'Payment page', edited: true } : n,
      ),
    };
    applyClientView(diagram);
    expect(diagram.blocks.map((b) => b.name)).toContain('Payment page');
  });

  it('draws an arrow the client drew, including to a box that did not exist yet', () => {
    const diagram = shop();
    let view = deriveClientView(diagram);
    view = addBox(view, { name: 'Text the customer', type: 'job' });
    const confirmation = find(view, 'Confirmation');
    view = {
      ...view,
      edges: [
        ...view.edges,
        {
          id: 'cve_new',
          source: confirmation.id,
          target: 'cvn_Textthecustomer',
          type: 'calls',
          label: '',
          condition: '',
          edgeId: null,
          origin: 'client',
          via: [],
        },
      ],
    };
    diagram.clientView = view;

    applyClientView(diagram);
    const job = diagram.blocks.find((b) => b.name === 'Text the customer')!;
    const edge = diagram.edges.find((e) => e.source === confirmation.blockId && e.target === job.id);
    expect(edge, 'the arrow should arrive with the block it points at').toBeDefined();
  });

  it('will not delete anything unless asked', () => {
    const diagram = shop();
    const view = deriveClientView(diagram);
    const confirmation = find(view, 'Confirmation');
    diagram.clientView = {
      ...view,
      nodes: view.nodes.filter((n) => n.id !== confirmation.id),
      removed: [{ blockId: confirmation.blockId!, edgeId: '', name: 'Confirmation', at: '' }],
    };

    applyClientView(diagram);
    expect(diagram.blocks.map((b) => b.name)).toContain('Confirmation');

    applyClientView(diagram, { includeRemovals: true });
    expect(diagram.blocks.map((b) => b.name)).not.toContain('Confirmation');
  });

  it('changes nothing when asked to plan rather than act', () => {
    const diagram = shop();
    diagram.clientView = addBox(deriveClientView(diagram), { name: 'Text the customer', type: 'job' });
    const before = diagram.blocks.length;
    const result = applyClientView(diagram, { dryRun: true });
    expect(diagram.blocks).toHaveLength(before);
    expect(result.operations).toHaveLength(1);
    expect(result.batch).toBeNull();
  });

  it('has nothing to do straight after a derive', () => {
    const diagram = shop();
    diagram.clientView = deriveClientView(diagram);
    expect(clientViewOperations(diagram, diagram.clientView)).toHaveLength(0);
  });
});

describe('ensureClientView and rendering', () => {
  it('derives one the first time and keeps it after', () => {
    const diagram = shop();
    expect(diagram.clientView).toBeNull();
    const view = ensureClientView(diagram);
    expect(view.nodes.length).toBeGreaterThan(0);
    diagram.clientView = view;
    expect(ensureClientView(diagram)).toBe(view);
  });

  it('reads out as boxes, arrows and what is out of step', () => {
    const diagram = shop();
    const view = addBox(deriveClientView(diagram), { name: 'Text the customer', type: 'job' });
    const text = renderClientView(diagram, view);
    expect(text).toContain('Corner Shop — client view');
    expect(text).toContain('Browse (screen)');
    expect(text).toContain('Card accepted (decision)');
    expect(text).toContain('→');
    expect(text).toContain('Not in the technical diagram yet');
    expect(text).toContain('new automatic "Text the customer"');
    // No jargon reaches the page.
    expect(text).not.toContain('POST');
    expect(text).not.toContain('/orders');
  });

  it('travels with the diagram when the whole document is replaced', async () => {
    const { assignDiagramContent } = await import('@diagram-plus/core');
    const diagram = shop();
    const edited = structuredClone(diagram);
    edited.clientView = addBox(deriveClientView(edited), { name: 'Text the customer', type: 'job' });
    // What a save does: replace the content of the stored diagram with this one.
    assignDiagramContent(diagram, edited);
    expect(diagram.clientView?.nodes.map((n) => n.name)).toContain('Text the customer');
  });

  it('survives a round trip through the diagram schema', async () => {
    const { parseDiagram } = await import('@diagram-plus/core');
    const diagram = shop();
    diagram.clientView = deriveClientView(diagram);
    const reparsed = parseDiagram(JSON.parse(JSON.stringify(diagram)));
    expect(reparsed.clientView?.nodes).toHaveLength(diagram.clientView.nodes.length);
    expect(reparsed.clientView?.edges).toHaveLength(diagram.clientView.edges.length);
  });
});

describe('editClientView', () => {
  it('adds a box where the client wanted it, in their own words', () => {
    const view = deriveClientView(shop());
    const { view: after, errors } = editClientView(view, [
      {
        op: 'add_node',
        name: 'Text the customer',
        type: 'job',
        description: 'Let them know it shipped',
        after: 'Confirmation',
      },
    ]);
    expect(errors).toHaveLength(0);
    const added = find(after, 'Text the customer');
    expect(added.origin).toBe('client');
    expect(added.blockId).toBeNull();
    expect(names(after).indexOf('Text the customer')).toBe(
      names(after).indexOf('Confirmation') + 1,
    );
  });

  it('marks a box reworded only when there is a block to have diverged from', () => {
    const view = deriveClientView(shop());
    const { view: withBox } = editClientView(view, [
      { op: 'add_node', name: 'Text the customer', type: 'job' },
    ]);
    const { view: after } = editClientView(withBox, [
      { op: 'update_node', node: 'Checkout', name: 'Payment page' },
      { op: 'update_node', node: 'Text the customer', name: 'Text them' },
    ]);
    expect(find(after, 'Payment page').edited).toBe(true);
    expect(find(after, 'Text them').edited).toBe(false);
  });

  it('takes a box out along with its arrows, and remembers that it went', () => {
    const view = deriveClientView(shop());
    const { view: after } = editClientView(view, [{ op: 'remove_node', node: 'Confirmation' }]);
    expect(names(after)).not.toContain('Confirmation');
    expect(after.removed.map((r) => r.name)).toContain('Confirmation');
    const ids = new Set(after.nodes.map((n) => n.id));
    expect(after.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
  });

  it('draws and cuts arrows between boxes named the way the client names them', () => {
    const view = deriveClientView(shop());
    const { view: joined } = editClientView(view, [
      { op: 'add_edge', source: 'Confirmation', target: 'Browse', label: 'Keep shopping' },
    ]);
    const drawn = joined.edges.find((e) => e.label === 'Keep shopping');
    expect(drawn?.origin).toBe('client');

    const { view: cut, errors } = editClientView(joined, [
      { op: 'remove_edge', source: 'Confirmation', target: 'Browse' },
    ]);
    expect(errors).toHaveLength(0);
    expect(cut.edges.some((e) => e.label === 'Keep shopping')).toBe(false);
  });

  it('reorders the walkthrough without losing anything left out of the list', () => {
    const view = deriveClientView(shop());
    const { view: after } = editClientView(view, [
      { op: 'reorder', order: ['Confirmation', 'Checkout'] },
    ]);
    expect(names(after).slice(0, 2)).toEqual(['Confirmation', 'Checkout']);
    expect(names(after)).toHaveLength(view.nodes.length);
  });

  it('reports the edit it could not make and applies the rest', () => {
    const view = deriveClientView(shop());
    const { view: after, applied, errors } = editClientView(view, [
      { op: 'update_node', node: 'Nothing called this', name: 'x' },
      { op: 'set_notes', notes: 'The client wants SMS receipts.' },
    ]);
    expect(applied).toBe(1);
    expect(errors[0]?.message).toContain('No box matching');
    expect(after.notes).toBe('The client wants SMS receipts.');
  });

  it('carries an edited box back to its block', () => {
    const diagram = shop();
    const { view } = editClientView(deriveClientView(diagram), [
      { op: 'update_node', node: 'Checkout', name: 'Payment page' },
    ]);
    diagram.clientView = view;
    applyClientView(diagram);
    expect(diagram.blocks.map((b) => b.name)).toContain('Payment page');
  });
});
