import { describe, expect, it } from 'vitest';
import { createDiagram } from '../src/factory.js';
import { addBlocks, addEdges } from '../src/operations.js';
import {
  ELEMENT_CATALOG,
  ELEMENT_TYPES,
  createElement,
  deriveDesign,
  designProgress,
  diffDesign,
  editDesign,
  findElement,
  hydrateElement,
  layoutDesign,
  parseDesign,
  reconcileDesign,
  renderElementOutline,
  renderScreenOutline,
  walkElements,
  type DesignDocument,
  type DesignOperation,
} from '../src/index.js';

/** A small diagram with the two screens most of these tests work against. */
function shop() {
  const diagram = createDiagram({ name: 'Shop', slug: 'shop' });
  addBlocks(diagram, [
    {
      type: 'ui_screen',
      name: 'Login',
      data: {
        route: '/login',
        purpose: 'Sign in',
        layout: 'centred form',
        state: [
          { name: 'email', type: 'string', required: true },
          { name: 'rememberMe', type: 'boolean' },
          { name: 'notes', type: 'string' },
        ],
        actions: [{ name: 'Sign in', calls: 'POST /api/session' }],
      },
    },
    {
      type: 'ui_screen',
      name: 'Products',
      data: { route: '/products', purpose: 'Browse', layout: 'a list of rows' },
    },
    { type: 'api_endpoint', name: 'Create session', data: { method: 'POST', path: '/api/session' } },
  ] as never);
  addEdges(diagram, [{ source: 'Login', target: 'Products', type: 'navigation' }] as never);
  return diagram;
}

function screenNamed(document: DesignDocument, name: string) {
  const screen = document.screens.find((s) => s.name === name);
  if (!screen) throw new Error(`no screen "${name}"`);
  return screen;
}

function apply(document: DesignDocument, ...operations: DesignOperation[]) {
  return editDesign(document, operations);
}

describe('the element catalog', () => {
  it('describes every element type, and only real ones', () => {
    expect(Object.keys(ELEMENT_CATALOG).sort()).toEqual([...ELEMENT_TYPES].sort());
    for (const type of ELEMENT_TYPES) {
      const info = ELEMENT_CATALOG[type];
      expect(info.type, type).toBe(type);
      expect(info.label.length, type).toBeGreaterThan(0);
      expect(info.description.length, type).toBeGreaterThan(0);
      expect(info.whenToUse.length, type).toBeGreaterThan(0);
      // The defaults have to survive the schema they claim to be defaults for.
      expect(() => createElement(type), type).not.toThrow();
    }
  });

  it('gives a new element its type-specific defaults', () => {
    const button = createElement('button');
    expect(button.text).toBe('Continue');
    expect(button.style.background).toBe('accent');
    expect(button.id).toMatch(/^els_/);

    // A patch wins over the defaults, and nested objects merge rather than
    // replace — asking for a wide button keeps its padding.
    const wide = createElement('button', { text: 'Buy', layout: { width: 'fill' } });
    expect(wide.text).toBe('Buy');
    expect(wide.layout.width).toBe('fill');
    expect(wide.layout.height).toBe(40);
    expect(wide.layout.padding.left).toBe(20);
  });
});

describe('reading a tree written by hand', () => {
  it('mints ids and fills defaults through the whole tree', () => {
    const root = hydrateElement({
      type: 'stack',
      children: [
        { type: 'heading', text: 'Hello' },
        { type: 'button', text: 'Go', action: 'POST /api/go' },
      ],
    });

    expect(root.id).toMatch(/^els_/);
    expect(root.children).toHaveLength(2);
    expect(root.children[1]!.style.background).toBe('accent');
    expect(new Set(walkElements(root).map((e) => e.id)).size).toBe(3);
  });

  it('keeps ids that were supplied', () => {
    const root = hydrateElement({ type: 'stack', id: 'els_keepme', children: [] });
    expect(root.id).toBe('els_keepme');
  });

  it('refuses an unknown type, and children under something that cannot hold them', () => {
    expect(() => hydrateElement({ type: 'wormhole' })).toThrow(/not an element type/);
    expect(() => hydrateElement({ type: 'text', children: [{ type: 'text' }] })).toThrow(
      /cannot hold other elements/,
    );
  });
});

describe('deriving designs from the diagram', () => {
  it('seeds a screen per UI block, carrying its bindings and actions across', () => {
    const document = deriveDesign(shop());
    expect(document.screens.map((s) => s.name)).toEqual(['Login', 'Products']);

    const login = screenNamed(document, 'Login');
    expect(login.route).toBe('/login');
    expect(login.blockId).toBeTruthy();

    const elements = walkElements(login.root);
    const email = elements.find((e) => e.binding === 'state.email');
    expect(email?.type).toBe('input');
    expect(email?.required).toBe(true);

    // The field types steer the control chosen for them.
    expect(elements.find((e) => e.binding === 'state.rememberMe')?.type).toBe('checkbox');
    expect(elements.find((e) => e.binding === 'state.notes')?.type).toBe('textarea');

    // The action became a button pointing at the endpoint it calls, and the
    // navigation edge told it where it goes afterwards.
    const button = elements.find((e) => e.type === 'button');
    expect(button?.action).toBe('POST /api/session');
    expect(button?.navigatesTo).toBe('Products');
  });

  it('reads the layout hint on the block', () => {
    const document = deriveDesign(shop());
    const products = screenNamed(document, 'Products');
    expect(walkElements(products.root).some((e) => e.type === 'list')).toBe(true);
  });

  it('only covers blocks that have an interface', () => {
    const document = deriveDesign(shop());
    expect(document.screens.some((s) => s.name === 'Create session')).toBe(false);
  });
});

describe('keeping designs in step with the diagram', () => {
  it('adds new screens, keeps drawn ones, and flags ones whose block has gone', () => {
    const diagram = shop();
    const first = deriveDesign(diagram);

    const drawn = apply(first, {
      op: 'set_tree',
      screen: 'Login',
      root: { type: 'stack', children: [{ type: 'heading', text: 'Hand-written' }] },
    }).document;

    addBlocks(diagram, [{ type: 'ui_screen', name: 'Basket', data: { route: '/basket' } }] as never);
    diagram.blocks = diagram.blocks.filter((b) => b.name !== 'Products');

    const result = reconcileDesign(diagram, drawn);
    expect(result.added).toEqual(['Basket']);
    expect(result.orphaned).toEqual(['Products']);

    // The work survives; the loss is visible rather than silent.
    expect(screenNamed(result.document, 'Login').root.children[0]!.text).toBe('Hand-written');
    expect(screenNamed(result.document, 'Products').orphaned).toBe(true);
    expect(result.document.screens).toHaveLength(3);
  });

  it('tracks the block name until somebody words the screen themselves', () => {
    const diagram = shop();
    const document = deriveDesign(diagram);

    const block = diagram.blocks.find((b) => b.name === 'Login')!;
    block.name = 'Sign in';
    expect(screenNamed(reconcileDesign(diagram, document).document, 'Sign in')).toBeTruthy();

    const edited = apply(document, {
      op: 'update_screen',
      screen: 'Login',
      name: 'Our lovely sign-in',
    }).document;
    block.name = 'Something else entirely';
    const after = reconcileDesign(diagram, edited).document;
    expect(after.screens.map((s) => s.name)).toContain('Our lovely sign-in');
  });

  it('reports what the diagram has that the designs do not', () => {
    const diagram = shop();
    const document = deriveDesign(diagram);
    expect(diffDesign(diagram, document).undesigned).toHaveLength(0);

    addBlocks(diagram, [{ type: 'ui_screen', name: 'Basket' }] as never);
    const diff = diffDesign(diagram, document);
    expect(diff.undesigned.map((b) => b.name)).toEqual(['Basket']);
    expect(diff.hasChanges).toBe(true);
  });
});

describe('editing a design', () => {
  it('applies what it can and reports what it cannot', () => {
    const document = deriveDesign(shop());
    const result = apply(
      document,
      { op: 'add_element', screen: 'Login', type: 'divider' },
      { op: 'remove_element', screen: 'Login', element: 'no such thing' },
      { op: 'update_screen', screen: 'Login', status: 'drafted' },
    );

    expect(result.applied).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.index).toBe(1);
    expect(screenNamed(result.document, 'Login').status).toBe('drafted');
  });

  it('adds into a named container, at a chosen index', () => {
    const document = deriveDesign(shop());
    const result = apply(document, {
      op: 'add_element',
      screen: 'Login',
      type: 'text',
      parent: 'Content',
      index: 0,
      props: { text: 'First thing' },
    });

    const content = findElement(screenNamed(result.document, 'Login').root, 'Content')!;
    expect(content.element.children[0]!.text).toBe('First thing');
  });

  it('refuses to put children inside something that cannot hold them', () => {
    const document = deriveDesign(shop());
    const result = apply(document, {
      op: 'add_element',
      screen: 'Login',
      type: 'text',
      parent: 'Title',
    });
    expect(result.applied).toBe(0);
    expect(result.errors[0]!.message).toMatch(/cannot hold other elements/);
  });

  it('retypes an element, keeping its words and losing what no longer applies', () => {
    const document = deriveDesign(shop());
    const before = walkElements(screenNamed(document, 'Login').root).find((e) => e.type === 'button')!;

    const result = apply(document, {
      op: 'update_element',
      screen: 'Login',
      element: before.id,
      type: 'link',
    });

    const after = findElement(screenNamed(result.document, 'Login').root, before.id)!.element;
    expect(after.type).toBe('link');
    expect(after.text).toBe('Sign in');
    expect(after.action).toBe('POST /api/session');
    // It took the link's look rather than keeping the button's fill.
    expect(after.style.background).toBe('');
    expect(after.style.color).toBe('accent');
  });

  it('merges layout and style patches rather than replacing them', () => {
    const document = deriveDesign(shop());
    const button = walkElements(screenNamed(document, 'Login').root).find((e) => e.type === 'button')!;

    const result = apply(document, {
      op: 'update_element',
      screen: 'Login',
      element: button.id,
      style: { background: 'danger' },
    });

    const after = findElement(screenNamed(result.document, 'Login').root, button.id)!.element;
    expect(after.style.background).toBe('danger');
    expect(after.style.radius).toBe('md');
  });

  it('moves an element between containers, but never inside itself', () => {
    const document = deriveDesign(shop());
    const login = screenNamed(document, 'Login');
    const content = findElement(login.root, 'Content')!.element;
    const header = findElement(login.root, 'Header')!.element;

    const moved = apply(document, {
      op: 'move_element',
      screen: 'Login',
      element: content.children[0]!.id,
      parent: header.id,
    });
    expect(moved.applied).toBe(1);
    expect(findElement(screenNamed(moved.document, 'Login').root, header.id)!.element.children)
      .toHaveLength(3);

    const cycle = apply(document, {
      op: 'move_element',
      screen: 'Login',
      element: content.id,
      parent: content.children[0]!.id,
    });
    expect(cycle.applied).toBe(0);
  });

  it('duplicates a subtree with fresh ids', () => {
    const document = deriveDesign(shop());
    const login = screenNamed(document, 'Login');
    const header = findElement(login.root, 'Header')!.element;

    const result = apply(document, { op: 'duplicate_element', screen: 'Login', element: header.id });
    const root = screenNamed(result.document, 'Login').root;
    const ids = walkElements(root).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(root.children).toHaveLength(3);
  });

  it('makes a variant artboard pointing at the same block', () => {
    const document = deriveDesign(shop());
    const result = apply(document, {
      op: 'duplicate_screen',
      screen: 'Products',
      variant: 'Empty',
    });

    const variants = result.document.screens.filter((s) => s.name === 'Products');
    expect(variants).toHaveLength(2);
    expect(variants[1]!.variant).toBe('Empty');
    expect(variants[1]!.blockId).toBe(variants[0]!.blockId);
    expect(variants[1]!.root.id).not.toBe(variants[0]!.root.id);
  });

  it('resolves a screen by name, by "Name / Variant" and by block id', () => {
    const document = apply(deriveDesign(shop()), {
      op: 'duplicate_screen',
      screen: 'Products',
      variant: 'Empty',
    }).document;

    const blockId = screenNamed(document, 'Login').blockId!;
    for (const ref of ['Login', blockId, 'Products / Empty']) {
      expect(apply(document, { op: 'update_screen', screen: ref, notes: 'x' }).applied, ref).toBe(1);
    }
  });

  it('changing the device resizes the frame', () => {
    const document = deriveDesign(shop());
    const result = apply(document, { op: 'update_screen', screen: 'Login', device: 'mobile' });
    expect(screenNamed(result.document, 'Login').frame).toEqual({ width: 390, height: 844 });
  });

  it('never removes the screen root through remove_element', () => {
    const document = deriveDesign(shop());
    const root = screenNamed(document, 'Login').root.id;
    const result = apply(document, { op: 'remove_element', screen: 'Login', element: root });
    expect(result.applied).toBe(0);
    expect(result.errors[0]!.message).toMatch(/remove_screen/);
  });
});

describe('arranging the canvas', () => {
  it('lays artboards out in rows and leaves dragged ones alone', () => {
    const document = deriveDesign(shop());
    const dragged = apply(document, {
      op: 'move_screen',
      screen: 'Products',
      x: 5000,
      y: 5000,
    }).document;

    const tidied = layoutDesign(dragged);
    expect(screenNamed(tidied, 'Products').position).toEqual({ x: 5000, y: 5000 });

    const forced = layoutDesign(dragged, { includePinned: true });
    expect(screenNamed(forced, 'Products').position.x).not.toBe(5000);
    expect(screenNamed(forced, 'Products').pinned).toBe(false);
  });
});

describe('reading a design back', () => {
  it('writes the outline the implementer builds from', () => {
    const document = deriveDesign(shop());
    const outline = renderScreenOutline(screenNamed(document, 'Login'));

    expect(outline).toContain('desktop 1440×900');
    expect(outline).toContain('`/login`');
    expect(outline).toContain('value ← state.email');
    expect(outline).toContain('does → POST /api/session');
    expect(outline).toContain('goes → Products');
  });

  it('says the states that were never drawn', () => {
    const document = apply(deriveDesign(shop()), {
      op: 'update_screen',
      screen: 'Login',
      states: [{ name: 'Loading', when: 'signing in', changes: 'The button shows a spinner.' }],
    }).document;

    const outline = renderScreenOutline(screenNamed(document, 'Login'));
    expect(outline).toContain('**Loading** (signing in) — The button shows a spinner.');
  });

  it('can leave the styling out', () => {
    const root = createElement('stack', {
      children: [createElement('heading', { text: 'Hi' })],
    });
    expect(renderElementOutline(root)).toContain('[heading.lg');
    expect(renderElementOutline(root, { showStyle: false })).not.toContain('[heading.lg');
  });
});

describe('progress', () => {
  it('counts the holes worth chasing', () => {
    const document = apply(deriveDesign(shop()), {
      op: 'set_tree',
      screen: 'Products',
      root: {
        type: 'stack',
        children: [
          { type: 'button', text: 'Does nothing' },
          { type: 'input', label: 'Nowhere to go' },
          { type: 'button', text: 'Fine', action: 'GET /api/products' },
        ],
      },
    }).document;

    const progress = designProgress(shop(), document);
    expect(progress.danglingActions.map((d) => d.element)).toEqual(['Does nothing']);
    expect(progress.unboundFields.map((d) => d.element)).toEqual(['Nowhere to go']);
  });

  it('counts a seeded wireframe as not yet designed', () => {
    const diagram = shop();
    const document = deriveDesign(diagram);
    expect(designProgress(diagram, document).completion).toBe(0);

    const drafted = apply(document, { op: 'update_screen', screen: 'Login', status: 'drafted' })
      .document;
    expect(designProgress(diagram, drafted).completion).toBe(50);
  });
});

describe('the file format', () => {
  it('survives a round trip through JSON', () => {
    const document = deriveDesign(shop());
    const reparsed = parseDesign(JSON.parse(JSON.stringify(document)));
    expect(reparsed).toEqual(document);
  });

  it('fills in everything a hand-written file leaves out', () => {
    const document = parseDesign({
      slug: 'shop',
      screens: [{ id: 'scr_1', name: 'Login', root: { id: 'els_1', type: 'stack' } }],
    });
    expect(document.formatVersion).toBe(1);
    expect(document.screens[0]!.device).toBe('desktop');
    expect(document.screens[0]!.root.children).toEqual([]);
    expect(document.system.colors).toEqual([]);
  });
});
